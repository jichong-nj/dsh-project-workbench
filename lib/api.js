/**
 * lib/api.js — 同源 HTTP 路由 `/workbench-api/*`（client 只通过它与 host 通信）。
 *
 * 返回约定：`{ ok: true, data }` / `{ ok: false, error: { code, message } }`。
 * 非 GET 请求做同源 Origin 校验（同 dsh-kanban / session-admin 的做法），
 * 插件路由不经 cookie 鉴权，靠它挡住跨站写请求。
 *
 * @module lib/api
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { statusForCode, toErrorInfo, WorkbenchError } from "./errors.js";
import { getUsageStats } from "./usage.js";

/** 路由前缀。 */
export const API_PREFIX = "/workbench-api";

/** JSON 请求体上限。 */
const JSON_LIMIT = 8 * 1024 * 1024;

/** 写 JSON。 */
function writeJson(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(body);
}

/** 写错误。 */
function writeError(res, status, code, message) {
	writeJson(res, status, { ok: false, error: { code, message: String(message) } });
}

/** 读二进制请求体（上传产物用），超限抛 400。 */
async function readBinaryBody(req, limit = 128 * 1024 * 1024) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > limit) throw new WorkbenchError("bad-request", `上传文件过大（上限 ${Math.round(limit / 1024 / 1024)}MB）`);
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/** 流式下载文件。 */
async function sendFile(res, filePath, name, mime, inline = false) {
	const info = await stat(filePath);
	const fallback = String(name ?? "download").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	const encoded = encodeURIComponent(String(name ?? "download"));
	res.writeHead(200, {
		"content-type": mime || "application/octet-stream",
		"content-length": info.size,
		"content-disposition": `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
		"cache-control": "no-store",
	});
	const body = await readFile(filePath);
	res.end(body);
}

/** 读 JSON 请求体。 */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		total += chunk.length;
		if (total > JSON_LIMIT) throw new WorkbenchError("bad-request", `请求体过大（上限 ${Math.round(JSON_LIMIT / 1024 / 1024)}MB）`);
		chunks.push(chunk);
	}
	if (total === 0) return {};
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text === "") return {};
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new WorkbenchError("bad-request", `请求 JSON 解析失败：${String(error?.message ?? error)}`);
	}
}

/** 同源校验：浏览器同源请求无 Origin 或 Origin.host === Host 才放行。 */
function isSameOrigin(req) {
	const origin = req.headers?.origin;
	if (typeof origin !== "string" || origin.length === 0) return true;
	try {
		const parsed = new URL(origin);
		const host = req.headers?.host;
		return typeof host === "string" && host.length > 0 && parsed.host === host;
	} catch {
		return false;
	}
}

/** 读取并解码一个路径段。 */
function segment(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * 创建纯 Node 请求处理器（便于离线测试）。
 * @param {import('./service.js').WorkbenchService} service
 * @param {{ logger?: { warn?: Function } }} [options]
 * @returns {(req: any, res: any) => Promise<void>}
 */
export function createApiHandler(service, { logger = null, assistant = null, getSpeechController = () => null, getSpeechToText = () => null } = {}) {
	return async function handle(req, res) {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (!url.pathname.startsWith(API_PREFIX)) return writeError(res, 404, "not-found", "unknown route");
		const suffix = url.pathname.slice(API_PREFIX.length);
		const parts = suffix.split("/").filter((part) => part !== "").map(segment);

		if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) {
			return writeError(res, 403, "forbidden", "cross-origin requests are not allowed");
		}

		try {
			const method = req.method ?? "GET";

			// /workbench-api 或 /workbench-api/health
			if (parts.length === 0 || (parts.length === 1 && parts[0] === "health")) {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				return writeJson(res, 200, {
					ok: true,
					data: {
						plugin: "@jichong/dsh-project-workbench",
						status: "ok",
						routes: [
							"GET /settings",
							"POST /settings/root",
							"GET /projects",
							"POST /projects",
							"GET /projects/:id",
							"PATCH /projects/:id",
							"DELETE /projects/:id",
							"GET /projects/:id/tasks",
							"POST /projects/:id/tasks",
							"GET /projects/:id/board",
							"GET /tasks/:id",
							"PATCH /tasks/:id",
							"POST /tasks/:id/comments",
							"POST /tasks/:id/comments/:commentId/resolve",
							"POST /tasks/:id/move",
						],
					},
				});
			}

			// 语音准备：确保 provider（如本地 SenseVoice）已 ready
			if (parts[0] === "speech" && parts.length === 2 && parts[1] === "prepare") {
				if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				const speechToText = getSpeechToText();
				if (speechToText === null || speechToText === undefined || typeof speechToText.prepare !== "function") {
					return writeError(res, 409, "speech-unavailable", "语音服务未加载（DSH voice input 未启用）");
				}
				const body = await readJsonBody(req);
				const snapshot = speechToText.snapshot();
				const providerId = typeof body?.providerId === "string" && body.providerId !== "" ? body.providerId : snapshot.selection?.providerId;
				if (typeof providerId !== "string" || providerId === "") return writeError(res, 409, "speech-unavailable", "没有可用的语音 provider");
				speechToText.prepare(providerId, typeof body?.downloadSource === "string" ? { downloadSource: body.downloadSource } : undefined);
				const started = Date.now();
				let state = null;
				while (Date.now() - started < 120000) {
					const current = speechToText.snapshot();
					const provider = (current.providers ?? []).find((item) => item.id === providerId);
					state = provider?.preparation ?? null;
					if (state?.phase === "ready" || state?.phase === "standby") {
						return writeJson(res, 200, { ok: true, data: { providerId, preparation: state } });
					}
					if (state?.phase === "failed") {
						return writeError(res, 502, "speech-preparation-failed", state.message ?? "语音模型准备失败");
					}
					if (state?.phase === "cancelled") return writeError(res, 409, "speech-preparation-cancelled", "语音模型准备已取消");
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
				return writeError(res, 504, "speech-preparation-timeout", "语音模型准备超时（120s）");
			}

			// 语音转写：复用 DSH speechController（与标准聊天同一服务）
			if (parts[0] === "speech" && parts.length === 2 && parts[1] === "transcribe") {
				if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				const controller = getSpeechController();
				if (controller === null || controller === undefined || typeof controller.transcribe !== "function") {
					return writeError(res, 409, "speech-unavailable", "语音转写服务未加载（DSH voice input 未启用）");
				}
				const body = await readJsonBody(req);
				if (typeof body?.audioBase64 !== "string" || body.audioBase64 === "") {
					return writeError(res, 400, "speech-invalid-audio", "audioBase64 不能为空");
				}
				try {
					const transcript = await controller.transcribe(
						{ audioBase64: body.audioBase64, ...(typeof body.providerId === "string" ? { providerId: body.providerId } : {}), ...(typeof body.language === "string" ? { language: body.language } : {}) },
						AbortSignal.timeout(120000),
					);
					return writeJson(res, 200, { ok: true, data: transcript });
				} catch (error) {
					logger?.warn?.(`[project-workbench] speech transcribe failed: ${String(error?.stack ?? error)}`);
					return writeError(res, 502, "speech-transcription-failed", String(error?.message ?? error));
				}
			}

			// AI 助手对话（带工作台工具调用）
			if (parts[0] === "assistant" && parts.length === 2 && parts[1] === "chat") {
				if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				if (assistant === null || typeof assistant.chat !== "function") {
					return writeError(res, 409, "model-unavailable", "AI 助手暂不可用：DSH 的 LLM 服务未加载");
				}
				const body = await readJsonBody(req);
				const data = await assistant.chat({ message: body?.message, history: body?.history });
				return writeJson(res, 200, { ok: true, data });
			}

			// 首页聚合
			if (parts[0] === "dashboard" && parts.length === 1) {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				const data = await service.getDashboard();
				return writeJson(res, 200, { ok: true, data });
			}

			// 侧边栏角标：待处理任务数
			if (parts[0] === "badge" && parts.length === 1) {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				return writeJson(res, 200, { ok: true, data: await service.getBadgeCounts() });
			}

			// 工作台自己的用量统计（扫描 DSH 会话日志，不依赖 usage-stats 插件）
			if (parts[0] === "usage" && parts.length === 1) {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				return writeJson(res, 200, { ok: true, data: getUsageStats() });
			}

			// 按会话反查任务上下文（右侧工作台面板）
			if (parts[0] === "context-by-session" && parts.length === 2) {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				const data = await service.getTaskBySession(parts[1]);
				return writeJson(res, 200, { ok: true, data });
			}

			// 子目标及其会话/产物
			if (parts[0] === "goals" && parts.length >= 2) {
				const goalId = parts[1];
				if (parts.length === 2) {
					if (method === "GET") {
						const data = await service.getGoal(goalId);
						return writeJson(res, 200, { ok: true, data });
					}
					if (method === "PATCH" || method === "PUT") {
						const body = await readJsonBody(req);
						const data = await service.updateGoal(goalId, { ...body, actor: "user" });
						return writeJson(res, 200, { ok: true, data });
					}
					if (method === "DELETE") {
						const data = await service.deleteGoal(goalId);
						return writeJson(res, 200, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 3 && parts[2] === "sessions") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const body = await readJsonBody(req);
					const data = await service.linkGoalSession(goalId, { ...body, actor: "user" });
					return writeJson(res, 201, { ok: true, data });
				}
				if (parts.length === 4 && parts[2] === "sessions") {
					if (method !== "DELETE") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.unlinkGoalSession(goalId, parts[3]);
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 3 && parts[2] === "artifacts") {
					if (method === "GET") {
						const data = await service.getGoal(goalId);
						return writeJson(res, 200, { ok: true, data: { artifacts: data.goal.artifacts } });
					}
					if (method === "POST") {
						const body = await readJsonBody(req);
						const data = await service.linkGoalArtifact(goalId, { ...body, actor: "user" });
						return writeJson(res, 201, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 4 && parts[2] === "artifacts" && parts[3] === "upload") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const kind = url.searchParams.get("kind") ?? "input";
					const name = url.searchParams.get("name") ?? `upload-${Date.now()}`;
					const note = url.searchParams.get("note") ?? "";
					const buffer = await readBinaryBody(req);
					const data = await service.uploadGoalArtifact(goalId, {
						kind,
						name,
						note,
						buffer,
						mime: req.headers["content-type"] ?? "",
						actor: "user",
					});
					return writeJson(res, 201, { ok: true, data });
				}
				if (parts.length === 4 && parts[2] === "artifacts" && parts[3] === "sync") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.syncGoalArtifacts(goalId);
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 4 && parts[2] === "artifacts") {
					if (method !== "DELETE") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.deleteGoalArtifact(goalId, parts[3], { deleteFile: url.searchParams.get("deleteFile") === "1" });
					return writeJson(res, 200, { ok: true, data });
				}
				return writeError(res, 404, "not-found", `unknown route: ${method} ${url.pathname}`);
			}

			// 产物下载
			if (parts[0] === "artifacts" && parts.length === 3 && parts[2] === "content") {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				const found = await service.getArtifact(parts[1]);
				await sendFile(res, found.artifact.path, found.artifact.name, found.artifact.mime, true);
				return undefined;
			}

			// 工作台设置 / 根目录迁移
			if (parts[0] === "settings") {
				if (parts.length === 1) {
					if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.getSettings();
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 2 && parts[1] === "root") {
					if (method !== "POST" && method !== "PATCH") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const body = await readJsonBody(req);
					const data = await service.changeWorkbenchRoot(body?.workbenchRoot ?? body?.rootPath ?? "");
					return writeJson(res, 200, { ok: true, data });
				}
				return writeError(res, 404, "not-found", `unknown route: ${method} ${url.pathname}`);
			}

			// 项目集合
			if (parts[0] === "projects") {
				if (parts.length === 1) {
					if (method === "GET") {
						const status = url.searchParams.get("status") ?? "active";
						const data = await service.listProjects({ status });
						return writeJson(res, 200, { ok: true, data });
					}
					if (method === "POST") {
						const body = await readJsonBody(req);
						const data = await service.createProject({ ...body, actor: "user" });
						return writeJson(res, 201, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				const projectId = parts[1];
				if (parts.length === 2) {
					if (method === "GET") {
						const taskStatus = url.searchParams.get("taskStatus") ?? url.searchParams.get("status") ?? "all";
						const data = await service.getProject(projectId, { taskStatus });
						return writeJson(res, 200, { ok: true, data });
					}
					if (method === "PATCH" || method === "PUT") {
						const body = await readJsonBody(req);
						const data = await service.updateProject(projectId, { ...body, actor: "user" });
						return writeJson(res, 200, { ok: true, data });
					}
					if (method === "DELETE") {
						const data = await service.deleteProject(projectId);
						return writeJson(res, 200, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 3 && parts[2] === "tasks") {
					if (method === "GET") {
						const taskStatus = url.searchParams.get("taskStatus") ?? url.searchParams.get("status") ?? "all";
						const detail = await service.getProject(projectId, { taskStatus });
						return writeJson(res, 200, { ok: true, data: { project: detail.project, tasks: detail.tasks, stats: detail.stats, filteredTotal: detail.filteredTotal } });
					}
					if (method === "POST") {
						const body = await readJsonBody(req);
						const data = await service.createTask({ ...body, projectId, actor: "user" });
						return writeJson(res, 201, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 3 && parts[2] === "board") {
					if (method !== "GET") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.board(projectId);
					return writeJson(res, 200, { ok: true, data });
				}
				return writeError(res, 404, "not-found", `unknown route: ${method} ${url.pathname}`);
			}

			// 单个任务
			if (parts[0] === "tasks" && parts.length === 1) {
				if (method !== "GET" && method !== "HEAD") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				const status = url.searchParams.get("status") ?? "all";
				const data = await service.listAllTasks({ status });
				return writeJson(res, 200, { ok: true, data });
			}

			if (parts[0] === "tasks" && parts.length >= 2) {
				const taskId = parts[1];
				if (parts.length === 2) {
					if (method === "GET") {
						const detail = await service.getTask(taskId);
						return writeJson(res, 200, { ok: true, data: detail });
					}
					if (method === "PATCH" || method === "PUT") {
						const body = await readJsonBody(req);
						const data = await service.updateTask(taskId, { ...body, actor: "user" });
						return writeJson(res, 200, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 3 && parts[2] === "comments") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const body = await readJsonBody(req);
					const data = await service.addTaskComment(taskId, { ...body, actor: "user" });
					return writeJson(res, 201, { ok: true, data });
				}
				if (parts.length === 5 && parts[2] === "comments" && parts[4] === "resolve") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const body = await readJsonBody(req);
					const data = await service.resolveTaskComment(taskId, parts[3], { resolved: body?.resolved !== false, actor: "user" });
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 3 && parts[2] === "move") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const body = await readJsonBody(req);
					const data = await service.moveTask(taskId, body?.status, { actor: "user" });
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 3 && parts[2] === "session") {
					if (method === "POST") {
						const body = await readJsonBody(req);
						const data = await service.linkTaskSession(taskId, { ...body, actor: "user" });
						return writeJson(res, 201, { ok: true, data });
					}
					if (method === "DELETE") {
						const data = await service.unlinkTaskSession(taskId);
						return writeJson(res, 200, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 3 && parts[2] === "artifacts") {
					if (method === "GET") {
						const detail = await service.getTask(taskId);
						return writeJson(res, 200, { ok: true, data: { artifacts: detail.artifacts } });
					}
					if (method === "POST") {
						const body = await readJsonBody(req);
						const data = await service.linkTaskArtifact(taskId, { ...body, actor: "user" });
						return writeJson(res, 201, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				if (parts.length === 4 && parts[2] === "artifacts" && parts[3] === "upload") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const kind = url.searchParams.get("kind") ?? "input";
					const name = url.searchParams.get("name") ?? `upload-${Date.now()}`;
					const note = url.searchParams.get("note") ?? "";
					const buffer = await readBinaryBody(req);
					const data = await service.uploadTaskArtifact(taskId, { kind, name, note, buffer, mime: req.headers["content-type"] ?? "", actor: "user" });
					return writeJson(res, 201, { ok: true, data });
				}
				if (parts.length === 4 && parts[2] === "artifacts" && parts[3] === "sync") {
					if (method !== "POST") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.syncTaskArtifacts(taskId);
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 4 && parts[2] === "artifacts") {
					if (method !== "DELETE") return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
					const data = await service.deleteTaskArtifact(taskId, parts[3], { deleteFile: url.searchParams.get("deleteFile") === "1" });
					return writeJson(res, 200, { ok: true, data });
				}
				if (parts.length === 3 && parts[2] === "goals") {
					if (method === "GET") {
						const detail = await service.getTask(taskId);
						return writeJson(res, 200, { ok: true, data: { goals: detail.goals } });
					}
					if (method === "POST") {
						const body = await readJsonBody(req);
						const data = await service.createGoal(taskId, { ...body, actor: "user" });
						return writeJson(res, 201, { ok: true, data });
					}
					return writeError(res, 405, "method-not-allowed", `method not allowed: ${method}`);
				}
				return writeError(res, 404, "not-found", `unknown route: ${method} ${url.pathname}`);
			}

			return writeError(res, 404, "not-found", `unknown route: ${method} ${url.pathname}`);
		} catch (error) {
			const info = toErrorInfo(error);
			const status = statusForCode(info.code);
			logger?.warn?.(`[project-workbench] ${req.method} ${url.pathname} failed: [${info.code}] ${info.message}`);
			if (!res.headersSent) return writeError(res, status, info.code, info.message);
			return undefined;
		}
	};
}

/**
 * 把 API 处理器挂到 DSH webServer 前缀。
 * @param {{ webServer: { register: Function }, logger?: object }} ctx
 * @param {import('./service.js').WorkbenchService} service
 * @returns {() => void} disposer
 */
export function registerWorkbenchRoutes(ctx, service, options = {}) {
	const registration = ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: createApiHandler(service, {
			logger: ctx.logger,
			assistant: options.assistant ?? null,
			getSpeechController: options.getSpeechController ?? (() => null),
			getSpeechToText: options.getSpeechToText ?? (() => null),
		}),
	});
	return () => {
		try {
			if (typeof registration === "function") registration();
			else if (typeof registration?.dispose === "function") registration.dispose();
		} catch {
			/* 忽略清理失败 */
		}
	};
}
