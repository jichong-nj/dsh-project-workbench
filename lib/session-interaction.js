// 读取 DSH 会话日志：最后一次交互时间 + 最近若干天的用户提问次数。
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

function dayKey(milliseconds) {
	const date = new Date(milliseconds);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseSession(file) {
	const text = decompressAll(fs.readFileSync(file));
	let last = 0;
	const questionDays = new Map();
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
		// 只统计真正的用户提问；runtime-context / plugin snapshot 等 user/message 不算。
		if (event.type === "user/message" && event.data?.source?.kind === "user") {
			const key = dayKey(event.time);
			questionDays.set(key, (questionDays.get(key) ?? 0) + 1);
		}
	}
	return { last, questionDays };
}

function fileForSession(sessionId) {
	if (typeof sessionId !== "string" || sessionId === "") return undefined;
	if (fileIndex === null || Date.now() - indexedAt > 60_000) {
		fileIndex = buildIndex();
		indexedAt = Date.now();
	}
	return fileIndex.get(sessionId);
}

function readSession(sessionId) {
	const file = fileForSession(sessionId);
	if (file === undefined) return null;
	let stat;
	try {
		stat = fs.statSync(file);
	} catch {
		return null;
	}
	const cached = resultCache.get(file);
	if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached;
	let parsed = { last: 0, questionDays: new Map() };
	try {
		parsed = parseSession(file);
	} catch {
		/* keep empty */
	}
	const value = { size: stat.size, mtimeMs: stat.mtimeMs, last: parsed.last > 0 ? parsed.last : stat.mtimeMs, questionDays: parsed.questionDays };
	resultCache.set(file, value);
	return value;
}

/** 会话最后一次用户提问/助手回答时间（epoch ms）；没有会话日志时返回 null。 */
export function getLastInteractionAt(sessionId) {
	const session = readSession(sessionId);
	return session === null ? null : session.last;
}

/** 最近 N 天每日用户提问次数，数组从最早到今天。 */
export function getQuestionActivity(sessionId, days = 7) {
	const session = readSession(sessionId);
	const counts = [];
	const now = new Date();
	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		counts.push(session?.questionDays.get(key) ?? 0);
	}
	return counts;
}
