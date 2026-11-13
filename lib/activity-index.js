// 任务近 7 天 token 用量索引：启动时一次性 backfill，之后由 DSH session 事件增量更新。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const FILE_NAME = "session.v4.jsonl.zstd";
const PERSIST_DELAY_MS = 800;

function sessionsRoot() {
	return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "sessions");
}

function dayKey(milliseconds) {
	const date = new Date(milliseconds);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function decompressAll(buffer) {
	const chunks = [];
	for (let index = 0; index + 4 <= buffer.length; index += 1) {
		if (buffer[index] !== 0x28 || buffer[index + 1] !== 0xb5 || buffer[index + 2] !== 0x2f || buffer[index + 3] !== 0xfd) continue;
		try {
			chunks.push(zlib.zstdDecompressSync(buffer.subarray(index)));
		} catch {
			/* false magic or partial frame */
		}
	}
	return Buffer.concat(chunks).toString("utf8");
}

function parseUsage(file) {
	const text = decompressAll(fs.readFileSync(file));
	const days = new Map();
	let last = 0;
	let start = 0;
	for (let index = 0; index <= text.length; index += 1) {
		if (index !== text.length && text.charCodeAt(index) !== 10) continue;
		const line = text.slice(start, index);
		start = index + 1;
		if (line.length === 0) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type !== "user/message" && event.type !== "assistant/message") continue;
		if (typeof event.time !== "number" || event.time <= 0) continue;
		if (event.time > last) last = event.time;
		if (event.type !== "assistant/message") continue;
		const usage = event.data?.usage;
		if (usage === undefined || usage === null) continue;
		const total = Number(usage.totalTokens ?? (Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0) + Number(usage.cacheReadTokens ?? 0) + Number(usage.cacheWriteTokens ?? 0)));
		if (!Number.isFinite(total) || total <= 0) continue;
		const key = dayKey(event.time);
		days.set(key, (days.get(key) ?? 0) + total);
	}
	return { days, last };
}

function listSessionFiles() {
	const root = sessionsRoot();
	const files = [];
	let workspaces;
	try {
		workspaces = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const workspace of workspaces) {
		if (!workspace.isDirectory()) continue;
		const workspacePath = path.join(root, workspace.name);
		let sessions;
		try {
			sessions = fs.readdirSync(workspacePath, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const session of sessions) {
			if (!session.isDirectory()) continue;
			const file = path.join(workspacePath, session.name, FILE_NAME);
			try {
				if (fs.statSync(file).isFile()) files.push({ sessionId: session.name, file });
			} catch {
				/* skip missing */
			}
		}
	}
	return files;
}

export class ActivityIndex {
	constructor({ getIndexPath, logger = null }) {
		this.getIndexPath = getIndexPath;
		this.logger = logger;
		this.entries = new Map();
		this.ready = false;
		this.persistTimer = null;
		this.disposeEvent = null;
		this.backfillPromise = null;
	}

	async start(ctx) {
		await this.load();
		if (ctx !== undefined && typeof ctx.on === "function") {
			this.disposeEvent = ctx.on("session/event", (session, event) => this.onSessionEvent(session, event));
		}
		this.backfillPromise = this.backfill().catch((error) => {
			this.logger?.warn?.(`[project-workbench] activity backfill failed: ${String(error?.stack ?? error)}`);
		});
	}

	dispose() {
		if (typeof this.disposeEvent === "function") this.disposeEvent();
		this.disposeEvent = null;
		if (this.persistTimer !== null) {
			clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
	}

	async load() {
		try {
			const text = await fs.promises.readFile(await this.getIndexPath(), "utf8");
			const parsed = JSON.parse(text);
			for (const [sessionId, entry] of Object.entries(parsed?.sessions ?? {})) {
				if (sessionId === "" || entry === null || typeof entry !== "object") continue;
				const days = {};
				for (const [date, value] of Object.entries(entry.days ?? {})) {
					const number = Number(value);
					if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(number) && number > 0) days[date] = number;
				}
				this.entries.set(sessionId, { days, last: Number(entry.last ?? 0), mtimeMs: Number(entry.mtimeMs ?? 0), size: Number(entry.size ?? 0) });
			}
		} catch {
			/* no snapshot yet */
		}
		this.ready = true;
	}

	async persist() {
		this.persistTimer = null;
		try {
			const file = await this.getIndexPath();
			await fs.promises.mkdir(path.dirname(file), { recursive: true });
			const sessions = {};
			for (const [sessionId, entry] of this.entries) sessions[sessionId] = entry;
			await fs.promises.writeFile(file, JSON.stringify({ version: 1, updatedAt: Date.now(), sessions }, null, 2), "utf8");
		} catch (error) {
			this.logger?.warn?.(`[project-workbench] activity index persist failed: ${String(error?.message ?? error)}`);
		}
	}

	schedulePersist() {
		if (this.persistTimer !== null) return;
		this.persistTimer = setTimeout(() => void this.persist(), PERSIST_DELAY_MS);
	}

	onSessionEvent(session, event) {
		if (event === undefined || event === null) return;
		const sessionId = session?.id;
		if (typeof sessionId !== "string" || sessionId === "") return;
		if (event.type !== "assistant/message") return;
		const usage = event.data?.usage;
		if (usage === undefined || usage === null || typeof event.time !== "number") return;
		const total = Number(usage.totalTokens ?? (Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0) + Number(usage.cacheReadTokens ?? 0) + Number(usage.cacheWriteTokens ?? 0)));
		if (!Number.isFinite(total) || total <= 0) return;
		const entry = this.entries.get(sessionId) ?? { days: {}, last: 0, mtimeMs: 0, size: 0 };
		const key = dayKey(event.time);
		entry.days[key] = (entry.days[key] ?? 0) + total;
		entry.last = Math.max(entry.last, event.time);
		this.entries.set(sessionId, entry);
		this.schedulePersist();
	}

	async refreshSession(sessionId) {
		if (typeof sessionId !== "string" || sessionId === "") return;
		const found = listSessionFiles().find((candidate) => candidate.sessionId === sessionId);
		if (found === undefined) return;
		const stat = fs.statSync(found.file);
		const parsed = parseUsage(found.file);
		this.entries.set(sessionId, { days: Object.fromEntries(parsed.days), last: parsed.last, mtimeMs: stat.mtimeMs, size: stat.size });
		this.schedulePersist();
	}

	async backfill() {
		const files = listSessionFiles();
		for (let index = 0; index < files.length; index += 1) {
			const candidate = files[index];
			let stat;
			try {
				stat = fs.statSync(candidate.file);
			} catch {
				continue;
			}
			const cached = this.entries.get(candidate.sessionId);
			if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) continue;
			try {
				const parsed = parseUsage(candidate.file);
				this.entries.set(candidate.sessionId, { days: Object.fromEntries(parsed.days), last: parsed.last, mtimeMs: stat.mtimeMs, size: stat.size });
			} catch {
				/* skip unreadable */
			}
			if (index % 20 === 19) await new Promise((resolve) => setImmediate(resolve));
		}
		await this.persist();
	}

	getLastInteractionAt(sessionId) {
		const entry = this.entries.get(sessionId);
		return entry === undefined || entry.last <= 0 ? null : entry.last;
	}

	getTokens(sessionId, days = 7) {
		const entry = this.entries.get(sessionId);
		const now = new Date();
		const result = [];
		for (let offset = days - 1; offset >= 0; offset -= 1) {
			const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
			const key = dayKey(date.getTime());
			result.push(entry?.days?.[key] ?? 0);
		}
		return result;
	}
}
