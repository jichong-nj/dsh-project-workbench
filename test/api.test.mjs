/**
 * test/api.test.mjs — /workbench-api 路由：读写、同源校验、错误码映射。
 */

import { Readable } from "node:stream";
import path from "node:path";

import { API_PREFIX, createApiHandler, registerWorkbenchRoutes } from "../lib/api.js";
import { WorkbenchService } from "../lib/service.js";
import { assert, createRunner, fakeStore, tempDir } from "./helpers.mjs";

const runner = createRunner("api");

function makeReq({ method = "GET", url, body, headers = {} }) {
	const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
	const req = Readable.from(payload);
	req.method = method;
	req.url = url;
	req.headers = { host: "127.0.0.1:3080", ...headers };
	return req;
}

function makeRawReq({ method = "GET", url, headers = {}, body = Buffer.alloc(0) }) {
	const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]);
	req.method = method;
	req.url = url;
	req.headers = { host: "127.0.0.1:3080", ...headers };
	return req;
}

function makeRes() {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		headersSent: false,
		writeHead(code, headers) {
			this.statusCode = code;
			this.headers = { ...headers };
			this.headersSent = true;
		},
		end(chunk) {
			this.body += chunk === undefined ? "" : String(chunk);
		},
	};
}

async function invokeRaw(handler, { method = "GET", path: route, body, headers }) {
	const res = makeRes();
	await handler(makeRawReq({ method, url: `${API_PREFIX}${route}`, body, headers }), res);
	return { status: res.statusCode, text: res.body };
}

async function invoke(handler, { method = "GET", path: route, body, headers }) {
	const res = makeRes();
	await handler(makeReq({ method, url: `${API_PREFIX}${route}`, body, headers }), res);
	let json = null;
	try {
		json = res.body === "" ? null : JSON.parse(res.body);
	} catch {
		json = null;
	}
	return { status: res.statusCode, json };
}

async function setup() {
	const store = fakeStore();
	const tmp = await tempDir();
	const service = new WorkbenchService({
		store,
		config: { workbenchRoot: path.join(tmp.dir, "workbench"), workbenchRootExplicit: true, exportPortableFiles: false },
		cwd: tmp.dir,
	});
	const handler = createApiHandler(service, { logger: { warn: () => undefined } });
	return { store, service, handler, tmp };
}

runner.test("GET /health 与根路由可用", async () => {
	const { handler, tmp } = await setup();
	try {
		for (const route of ["/health", "", "/"]) {
			const res = await invoke(handler, { path: route });
			assert.equal(res.status, 200);
			assert.equal(res.json.ok, true);
			assert.equal(res.json.data.plugin, "@jichong/dsh-project-workbench");
		}
	} finally {
		await tmp.cleanup();
	}
});

runner.test("项目 CRUD：创建 → 列表 → 详情 → 归档 → 恢复 → 删除空项目", async () => {
	const { handler, tmp } = await setup();
	try {
		const empty = await invoke(handler, { path: "/projects", method: "GET" });
		assert.equal(empty.status, 200);
		assert.equal(empty.json.data.total, 0);

		const created = await invoke(handler, {
			path: "/projects",
			method: "POST",
			body: { name: "接口项目", description: "HTTP 创建", folderName: "api-project" },
		});
		assert.equal(created.status, 201);
		const projectId = created.json.data.project.id;
		assert.equal(created.json.data.project.name, "接口项目");
		assert.equal(created.json.data.project.dirName, "api-project");
		assert.equal(created.json.data.project.rootPath, path.join(tmp.dir, "workbench", "api-project"));

		const listed = await invoke(handler, { path: "/projects?status=all" });
		assert.equal(listed.json.data.total, 1);

		const detail = await invoke(handler, { path: `/projects/${projectId}` });
		assert.equal(detail.status, 200);
		assert.equal(detail.json.data.project.id, projectId);
		assert.equal(detail.json.data.tasks.length, 0);

		const archived = await invoke(handler, { path: `/projects/${projectId}`, method: "PATCH", body: { status: "archived" } });
		assert.equal(archived.json.data.project.status, "archived");
		const denied = await invoke(handler, { path: `/projects/${projectId}/tasks`, method: "POST", body: { title: "x" } });
		assert.equal(denied.status, 409);
		assert.equal(denied.json.error.code, "project-archived");

		const restored = await invoke(handler, { path: `/projects/${projectId}`, method: "PATCH", body: { status: "active" } });
		assert.equal(restored.json.data.project.status, "active");

		const deleted = await invoke(handler, { path: `/projects/${projectId}`, method: "DELETE" });
		assert.equal(deleted.status, 200);
		assert.equal(deleted.json.data.deleted, true);
	} finally {
		const allTasks = await invokeRaw(handler, { path: "/tasks?status=all" });
		assert.equal(allTasks.status, 200);
		const allPayload = JSON.parse(allTasks.text);
		assert.equal(allPayload.ok, true);
		assert.ok(Array.isArray(allPayload.data.tasks));
		await tmp.cleanup();
	}
});

runner.test("首页 Dashboard 聚合路由", async () => {
	const { handler, tmp } = await setup();
	try {
		const empty = await invoke(handler, { path: "/dashboard" });
		assert.equal(empty.status, 200);
		assert.equal(empty.json.data.projects.length, 0);
		assert.equal(empty.json.data.todayTasks.length, 0);
		const project = await invoke(handler, { path: "/projects", method: "POST", body: { name: "DASH", folderName: "dash" } });
		await invoke(handler, { path: `/projects/${project.json.data.project.id}/tasks`, method: "POST", body: { title: "今日", dueAt: new Date().toISOString() } });
		const dashboard = await invoke(handler, { path: "/dashboard" });
		assert.equal(dashboard.status, 200);
		assert.equal(dashboard.json.data.projects.length, 1);
		assert.equal(dashboard.json.data.projects[0].name, "DASH");
		assert.equal(dashboard.json.data.todayTasks.length, 1);
		assert.ok(Array.isArray(dashboard.json.data.recentTasks));
		assert.ok(dashboard.json.data.recentTasks.length >= 1);
		assert.ok(Array.isArray(dashboard.json.data.insights));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("工作台设置：读取根目录、迁移根目录并保留项目/任务", async () => {
	const { handler, tmp } = await setup();
	try {
		const settings = await invoke(handler, { path: "/settings" });
		assert.equal(settings.status, 200);
		assert.equal(settings.json.data.workbenchRoot, path.join(tmp.dir, "workbench"));
		assert.equal(settings.json.data.projectCount, 0);

		const project = await invoke(handler, { path: "/projects", method: "POST", body: { name: "迁移项目", folderName: "move-me" } });
		const projectId = project.json.data.project.id;
		const task = await invoke(handler, { path: `/projects/${projectId}/tasks`, method: "POST", body: { title: "迁移任务", agentsMd: "# x\n" } });
		const taskId = task.json.data.task.id;

		const newRoot = path.join(tmp.dir, "workbench-moved");
		const migrated = await invoke(handler, { path: "/settings/root", method: "POST", body: { workbenchRoot: newRoot } });
		assert.equal(migrated.status, 200);
		assert.equal(migrated.json.data.workbenchRoot, newRoot);
		assert.equal(migrated.json.data.migrated, true);
		assert.equal(migrated.json.data.movedProjects, 1);

		const detail = await invoke(handler, { path: `/projects/${projectId}` });
		assert.equal(detail.json.data.project.rootPath, path.join(newRoot, "move-me"));
		const taskDetail = await invoke(handler, { path: `/tasks/${taskId}` });
		assert.equal(taskDetail.json.data.taskDir, path.join(newRoot, "move-me", "tasks", taskId));
		assert.equal(taskDetail.json.data.instructions.task.path, path.join(newRoot, "move-me", "tasks", taskId, "AGENTS.md"));

		const denied = await invoke(handler, { path: "/settings/root", method: "POST", body: { workbenchRoot: path.join(newRoot, "nested") } });
		assert.equal(denied.status, 409);
		assert.equal(denied.json.error.code, "root-migration-failed");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("任务链路：创建 → 详情 → 更新 → 评论 → 看板 → 移动", async () => {
	const { handler, tmp } = await setup();
	try {
		const project = await invoke(handler, { path: "/projects", method: "POST", body: { name: "任务项目", rootPath: path.join(tmp.dir, "t") } });
		const projectId = project.json.data.project.id;

		const created = await invoke(handler, {
			path: `/projects/${projectId}/tasks`,
			method: "POST",
			body: { title: "写周报", description: "本周进展", priority: "high", dueAt: "2026-12-01" },
		});
		assert.equal(created.status, 201);
		const taskId = created.json.data.task.id;
		assert.equal(created.json.data.task.status, "backlog");

		const detail = await invoke(handler, { path: `/tasks/${taskId}` });
		assert.equal(detail.status, 200);
		assert.equal(detail.json.data.task.title, "写周报");
		assert.equal(detail.json.data.instructions.project.exists, true);
		assert.equal(detail.json.data.instructions.task, null);

		const updated = await invoke(handler, { path: `/tasks/${taskId}`, method: "PATCH", body: { status: "running", priority: "urgent" } });
		assert.equal(updated.json.data.task.status, "running");
		assert.equal(updated.json.data.task.priority, "urgent");

		const comment = await invoke(handler, { path: `/tasks/${taskId}/comments`, method: "POST", body: { body: "请补充数据", author: "reviewer" } });
		assert.equal(comment.status, 201);
		assert.equal(comment.json.data.needsYou, true);
		const commentId = comment.json.data.comment.id;

		const board = await invoke(handler, { path: `/projects/${projectId}/board` });
		assert.equal(board.status, 200);
		assert.deepEqual(
			board.json.data.columns.map((column) => column.key),
			["backlog", "running", "needs-you", "done"],
		);
		assert.equal(board.json.data.columns.find((column) => column.key === "needs-you").tasks.length, 1);

		const resolved = await invoke(handler, { path: `/tasks/${taskId}/comments/${commentId}/resolve`, method: "POST", body: { resolved: true } });
		assert.equal(resolved.json.data.task.viewStatus, "running");

		const moved = await invoke(handler, { path: `/tasks/${taskId}/move`, method: "POST", body: { status: "done" } });
		assert.equal(moved.status, 200);
		assert.equal(moved.json.data.task.status, "done");
		assert.equal(moved.json.data.task.viewStatus, "done");

		const deniedMove = await invoke(handler, { path: `/tasks/${taskId}/move`, method: "POST", body: { status: "needs-you" } });
		assert.equal(deniedMove.status, 409);
		assert.equal(deniedMove.json.error.code, "needs-you-derived");

		const deletedNonEmpty = await invoke(handler, { path: `/projects/${projectId}`, method: "DELETE" });
		assert.equal(deletedNonEmpty.status, 409);
		assert.equal(deletedNonEmpty.json.error.code, "project-not-empty");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("子目标/会话/产物：创建、关联会话、上传/下载、同步、删除", async () => {
	const { handler, tmp } = await setup();
	try {
		const project = await invoke(handler, { path: "/projects", method: "POST", body: { name: "目标项目", folderName: "goal-api" } });
		const projectId = project.json.data.project.id;
		const task = await invoke(handler, { path: `/projects/${projectId}/tasks`, method: "POST", body: { title: "T", goal: "交付材料" } });
		const taskId = task.json.data.task.id;
		assert.equal(task.json.data.task.goal, "交付材料");

		const goal = await invoke(handler, { path: `/tasks/${taskId}/goals`, method: "POST", body: { title: "收集证据", description: "合同" } });
		assert.equal(goal.status, 201);
		const goalId = goal.json.data.goal.id;
		assert.ok(goal.json.data.goal.dir.includes("/tasks/" + taskId + "/goals/"));

		const updated = await invoke(handler, { path: `/goals/${goalId}`, method: "PATCH", body: { status: "doing" } });
		assert.equal(updated.json.data.goal.status, "doing");

		const linked = await invoke(handler, {
			path: `/goals/${goalId}/sessions`,
			method: "POST",
			body: { sessionId: "sess-1", title: "证据整理会话", cwd: "/tmp/goal", status: "running" },
		});
		assert.equal(linked.status, 201);
		assert.equal(linked.json.data.goal.sessionCount, 1);
		const linkId = linked.json.data.goal.sessions[0].id;
		const unlinked = await invoke(handler, { path: `/goals/${goalId}/sessions/${linkId}`, method: "DELETE" });
		assert.equal(unlinked.status, 200);
		assert.equal(unlinked.json.data.goal.sessionCount, 0);

		const content = Buffer.from("# 证据\n", "utf8");
		const uploaded = await invokeRaw(handler, {
			path: `/goals/${goalId}/artifacts/upload?kind=input&name=${encodeURIComponent("证据.md")}`,
			method: "POST",
			body: content,
			headers: { "content-type": "text/markdown" },
		});
		assert.equal(uploaded.status, 201);
		const artifact = JSON.parse(uploaded.text).data.artifact;
		assert.equal(artifact.kind, "input");
		assert.equal(artifact.size, content.length);

		const downloaded = await invokeRaw(handler, { path: `/artifacts/${artifact.id}/content` });
		assert.equal(downloaded.status, 200);
		assert.equal(downloaded.text, content.toString("utf8"));

		const synced = await invoke(handler, { path: `/goals/${goalId}/artifacts/sync`, method: "POST" });
		assert.equal(synced.status, 200);
		assert.equal(synced.json.data.added, 0);

		const taskDetail = await invoke(handler, { path: `/tasks/${taskId}` });
		assert.equal(taskDetail.json.data.goals.length, 1);
		assert.equal(taskDetail.json.data.goals[0].artifactCount, 1);

		const deletedArtifact = await invoke(handler, { path: `/goals/${goalId}/artifacts/${artifact.id}?deleteFile=1`, method: "DELETE" });
		assert.equal(deletedArtifact.json.data.goal.artifactCount, 0);

		const deletedGoal = await invoke(handler, { path: `/goals/${goalId}`, method: "DELETE" });
		assert.equal(deletedGoal.json.data.deleted, true);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("AI 助手对话路由：有 assistant 时返回回复，无 assistant 时返回 model-unavailable", async () => {
	const { service, tmp } = await setup();
	try {
		const handler = createApiHandler(service, {
			assistant: {
				chat: async ({ message }) => ({ reply: `echo:${message}`, actions: [], provider: "fake", model: "fake-model" }),
			},
		});
		const ok = await invoke(handler, { path: "/assistant/chat", method: "POST", body: { message: "你好", history: [] } });
		assert.equal(ok.status, 200);
		assert.equal(ok.json.data.reply, "echo:你好");
		assert.deepEqual(ok.json.data.actions, []);
		const missing = await invoke(handler, { path: "/assistant/chat", method: "POST", body: { message: "hi" } });
		assert.equal(missing.status, 200);
		const noAssistantHandler = createApiHandler(service, {});
		const denied = await invoke(noAssistantHandler, { path: "/assistant/chat", method: "POST", body: { message: "hi" } });
		assert.equal(denied.status, 409);
		assert.equal(denied.json.error.code, "model-unavailable");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("语音转写路由：有 speechController 时返回文本，无服务时 409", async () => {
	const { service, tmp } = await setup();
	try {
		const handler = createApiHandler(service, {
			getSpeechController: () => ({ transcribe: async (request) => ({ text: "你好工作台", audioSeconds: 1.2, request }) }),
		});
		const ok = await invoke(handler, { path: "/speech/transcribe", method: "POST", body: { audioBase64: "UklGRg==" } });
		assert.equal(ok.status, 200);
		assert.equal(ok.json.data.text, "你好工作台");
		const denied = await invoke(createApiHandler(service, {}), { path: "/speech/transcribe", method: "POST", body: { audioBase64: "UklGRg==" } });
		assert.equal(denied.status, 409);
		assert.equal(denied.json.error.code, "speech-unavailable");
		const empty = await invoke(handler, { path: "/speech/transcribe", method: "POST", body: {} });
		assert.equal(empty.status, 400);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("语音准备路由：provider ready 时返回状态", async () => {
	const { service, tmp } = await setup();
	try {
		const speechToText = {
			prepare: () => undefined,
			snapshot: () => ({ providers: [{ id: "fake", preparation: { phase: "ready" } }], selection: { providerId: "fake", language: "zh" } }),
		};
		const handler = createApiHandler(service, { getSpeechToText: () => speechToText });
		const ready = await invoke(handler, { path: "/speech/prepare", method: "POST", body: {} });
		assert.equal(ready.status, 200);
		assert.equal(ready.json.data.providerId, "fake");
		const denied = await invoke(createApiHandler(service, {}), { path: "/speech/prepare", method: "POST", body: {} });
		assert.equal(denied.status, 409);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("任务会话/成果路由：绑定会话、上传下载成果、同步、删除", async () => {
	const { handler, tmp } = await setup();
	try {
		const project = await invoke(handler, { path: "/projects", method: "POST", body: { name: "TS", folderName: "ts" } });
		const task = await invoke(handler, { path: `/projects/${project.json.data.project.id}/tasks`, method: "POST", body: { title: "T" } });
		const taskId = task.json.data.task.id;
		const linked = await invoke(handler, { path: `/tasks/${taskId}/session`, method: "POST", body: { sessionId: "session-api", title: "任务会话", cwd: "/tmp" } });
		assert.equal(linked.status, 201);
		assert.equal(linked.json.data.session.sessionId, "session-api");

		const content = Buffer.from("# 成果\n", "utf8");
		const uploaded = await invokeRaw(handler, { path: `/tasks/${taskId}/artifacts/upload?kind=output&name=${encodeURIComponent("成果.md")}`, method: "POST", body: content, headers: { "content-type": "text/markdown" } });
		assert.equal(uploaded.status, 201);
		const artifact = JSON.parse(uploaded.text).data.artifact;
		const downloaded = await invokeRaw(handler, { path: `/artifacts/${artifact.id}/content` });
		assert.equal(downloaded.text, content.toString("utf8"));
		const synced = await invoke(handler, { path: `/tasks/${taskId}/artifacts/sync`, method: "POST" });
		assert.equal(synced.status, 200);
		const detail = await invoke(handler, { path: `/tasks/${taskId}` });
		assert.equal(detail.json.data.session.sessionId, "session-api");
		assert.equal(detail.json.data.artifacts.length, 1);
		const removed = await invoke(handler, { path: `/tasks/${taskId}/artifacts/${artifact.id}?deleteFile=1`, method: "DELETE" });
		assert.equal(removed.status, 200);
		const unlinked = await invoke(handler, { path: `/tasks/${taskId}/session`, method: "DELETE" });
		assert.equal(unlinked.json.data.session, null);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("错误与安全：404 / 405 / 非 JSON / 跨站写请求 / 非法 id", async () => {
	const { handler, tmp } = await setup();
	try {
		const missing = await invoke(handler, { path: "/nope" });
		assert.equal(missing.status, 404);
		assert.equal(missing.json.error.code, "not-found");

		const methodDenied = await invoke(handler, { path: "/projects", method: "PUT" });
		assert.equal(methodDenied.status, 405);

		const crossOrigin = await invoke(handler, {
			path: "/projects",
			method: "POST",
			body: { name: "x" },
			headers: { origin: "http://evil.example" },
		});
		assert.equal(crossOrigin.status, 403);
		assert.equal(crossOrigin.json.error.code, "forbidden");

		const sameOrigin = await invoke(handler, {
			path: "/projects",
			method: "POST",
			body: { name: "同源项目", rootPath: path.join(tmp.dir, "same") },
			headers: { origin: "http://127.0.0.1:3080" },
		});
		assert.equal(sameOrigin.status, 201);

		const notFoundTask = await invoke(handler, { path: "/tasks/t-missing" });
		assert.equal(notFoundTask.status, 404);

		const badBody = await invoke(handler, {
			path: "/projects",
			method: "POST",
			body: undefined,
			headers: { "content-type": "application/json" },
		});
		// 空 body 视为 {}，进入业务校验：name 缺失 → 400
		assert.equal(badBody.status, 400);
		assert.equal(badBody.json.error.code, "invalid-input");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("registerWorkbenchRoutes 调用 ctx.webServer.register 并返回 disposer", async () => {
	const { service, tmp } = await setup();
	try {
		let registered = null;
		let disposed = 0;
		const ctx = {
			webServer: {
				register(options) {
					registered = options;
					return () => {
						disposed += 1;
					};
				},
			},
			logger: { warn: () => undefined },
		};
		const dispose = registerWorkbenchRoutes(ctx, service);
		assert.equal(registered.kind, "prefix");
		assert.equal(registered.path, API_PREFIX);
		assert.equal(typeof registered.handler, "function");
		dispose();
		assert.equal(disposed, 1);
	} finally {
		await tmp.cleanup();
	}
});

export default runner.run;
