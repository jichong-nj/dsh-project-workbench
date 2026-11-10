// 读取 DSH 会话日志中最后一次用户提问或助手回答的时间。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const FILE_NAME = "session.v4.jsonl.zstd";
let fileIndex = null;
let indexedAt = 0;
const resultCache = new Map();

function sessionsRoot() {
	return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "sessions");
}

function buildIndex() {
	const index = new Map();
	let workspaces;
	try {
		workspaces = fs.readdirSync(sessionsRoot(), { withFileTypes: true });
	} catch {
		return index;
	}
	for (const workspace of workspaces) {
		if (!workspace.isDirectory()) continue;
		const workspacePath = path.join(sessionsRoot(), workspace.name);
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
				if (fs.statSync(file).isFile()) index.set(session.name, file);
			} catch {
				/* skip missing */
			}
		}
	}
	return index;
}

function decompressAll(buffer) {
	const chunks = [];
	for (let index = 0; index + 4 <= buffer.length; index += 1) {
		if (buffer[index] !== 0x28 || buffer[index + 1] !== 0xb5 || buffer[index + 2] !== 0x2f || buffer[index + 3] !== 0xfd) continue;
		try {
			chunks.push(zlib.zstdDecompressSync(buffer.subarray(index)));
		} catch {
			/* ignore invalid frame */
		}
	}
	return Buffer.concat(chunks).toString("utf8");
}

function parseLastInteraction(file) {
	const text = decompressAll(fs.readFileSync(file));
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
		if (typeof event.time === "number" && event.time > last) last = event.time;
	}
	return last;
}

/** 会话最后一次用户提问/助手回答时间（epoch ms）；没有会话日志时返回 null。 */
export function getLastInteractionAt(sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") return null;
	if (fileIndex === null || Date.now() - indexedAt > 60_000) {
		fileIndex = buildIndex();
		indexedAt = Date.now();
	}
	const file = fileIndex.get(sessionId);
	if (file === undefined) return null;
	let stat;
	try {
		stat = fs.statSync(file);
	} catch {
		return null;
	}
	const cached = resultCache.get(file);
	if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.last;
	let last = 0;
	try {
		last = parseLastInteraction(file);
	} catch {
		last = 0;
	}
	const value = last > 0 ? last : stat.mtimeMs;
	resultCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, last: value });
	return value;
}
