// 工作台自带的用量统计：直接扫描 DSH 会话日志，按天 × 模型聚合 token。
// 不依赖 @jichong/dsh-usage-stats 插件。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const FILE_NAME = "session.v4.jsonl.zstd";
const CACHE_TTL_MS = 5000;
const fileCache = new Map();
let cachedAt = 0;
let cachedValue = null;

function sessionsRoot() {
	return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "sessions");
}

function emptyRecord() {
	return { calls: 0, inp: 0, out: 0, cacheR: 0, cacheW: 0, total: 0 };
}

function addRecord(target, source) {
	target.calls += source.calls;
	target.inp += source.inp;
	target.out += source.out;
	target.cacheR += source.cacheR;
	target.cacheW += source.cacheW;
	target.total += source.total;
}

function dayKey(milliseconds) {
	const date = new Date(milliseconds);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function listFiles() {
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
				if (fs.statSync(file).isFile()) files.push(file);
			} catch {
				/* skip missing */
			}
		}
	}
	return files;
}

function decompressAll(buffer) {
	const chunks = [];
	for (let index = 0; index + 4 <= buffer.length; index += 1) {
		if (buffer[index] !== 0x28 || buffer[index + 1] !== 0xb5 || buffer[index + 2] !== 0x2f || buffer[index + 3] !== 0xfd) continue;
		try {
			chunks.push(zlib.zstdDecompressSync(buffer.subarray(index)));
		} catch {
			/* false frame magic or partial frame */
		}
	}
	return Buffer.concat(chunks).toString("utf8");
}

function parseFile(file) {
	const text = decompressAll(fs.readFileSync(file));
	const days = new Map();
	let model = "unknown";
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
		const data = event.data;
		if (data === undefined || data === null) continue;
		if (event.type === "request/header") {
			const config = data.header?.config;
			if (config?.model) model = `${config.provider || "?"}/${config.model}`;
		} else if (event.type === "assistant/message") {
			const usage = data.usage;
			if (usage === undefined || usage === null || typeof event.time !== "number" || event.time <= 0) continue;
			const date = dayKey(event.time);
			let models = days.get(date);
			if (models === undefined) {
				models = new Map();
				days.set(date, models);
			}
			let record = models.get(model);
			if (record === undefined) {
				record = emptyRecord();
				models.set(model, record);
			}
			record.calls += 1;
			record.inp += usage.inputTokens ?? 0;
			record.out += usage.outputTokens ?? 0;
			record.cacheR += usage.cacheReadTokens ?? 0;
			record.cacheW += usage.cacheWriteTokens ?? 0;
			record.total += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
		}
	}
	return days;
}

function collect() {
	const files = listFiles();
	const seen = new Set(files);
	for (const file of [...fileCache.keys()]) if (!seen.has(file)) fileCache.delete(file);
	for (const file of files) {
		let stat;
		try {
			stat = fs.statSync(file);
		} catch {
			continue;
		}
		const cached = fileCache.get(file);
		if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) continue;
		try {
			fileCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, days: parseFile(file) });
		} catch {
			fileCache.delete(file);
		}
	}
	const merged = new Map();
	for (const entry of fileCache.values()) {
		for (const [date, models] of entry.days) {
			let day = merged.get(date);
			if (day === undefined) {
				day = new Map();
				merged.set(date, day);
			}
			for (const [model, record] of models) {
				let target = day.get(model);
				if (target === undefined) {
					target = emptyRecord();
					day.set(model, target);
				}
				addRecord(target, record);
			}
		}
	}
	const days = [...merged.entries()]
		.sort((left, right) => (left[0] < right[0] ? -1 : 1))
		.map(([date, models]) => ({ date, models: Object.fromEntries(models) }));
	return { generatedAt: Date.now(), files: fileCache.size, days };
}

/** 返回全部会话的按天/模型用量；5 秒内复用上次结果。 */
export function getUsageStats() {
	if (cachedValue !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cachedValue;
	cachedValue = collect();
	cachedAt = Date.now();
	return cachedValue;
}
