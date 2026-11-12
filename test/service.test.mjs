/**
 * test/service.test.mjs — 项目/任务业务、needs-you 派生、工作台根目录与自动迁移、
 * 任务目录（tasks/<taskId>）、AGENTS.md 骨架与便携导出。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	BOARD_COLUMNS,
	compareTasks,
	isNeedsYou,
	needsYouReasons,
	statsOf,
	unresolvedCommentCount,
	viewStatusOf,
	WorkbenchService,
} from "../lib/service.js";
import { buildProjectDirName, projectAgentsMdPath, taskAgentsMdPath, taskDirPath } from "../lib/agents.js";
import { assert, createRunner, fakeStore, tempDir } from "./helpers.mjs";

const runner = createRunner("service");

async function makeService({ workbenchRoot } = {}) {
	const store = fakeStore();
	const tmp = await tempDir();
	const root = workbenchRoot ?? path.join(tmp.dir, "workbench");
	const service = new WorkbenchService({
		store,
		config: {
			workbenchRoot: root,
			workbenchRootExplicit: true,
			enableBoardView: true,
			exportPortableFiles: true,
		},
		cwd: tmp.dir,
	});
	return { store, service, tmp, root };
}

runner.test("创建项目：目录自动建在工作台根下 + 生成项目级 AGENTS.md + 便携导出", async () => {
	const { service, store, tmp, root } = await makeService();
	try {
		const result = await service.createProject({ name: "领导交办 · 验收材料", description: "整理验收材料并提交" });
		assert.equal(result.project.name, "领导交办 · 验收材料");
		assert.equal(result.project.status, "active");
		assert.equal(result.workbenchRoot, root);
		assert.equal(path.dirname(result.project.rootPath), root);
		assert.equal(result.project.dirName, path.basename(result.project.rootPath));
		assert.match(result.project.dirName, /^领导交办-验收材料-/);
		const projectRoot = result.project.rootPath;
		assert.equal(result.agentsMd.created, true);
		assert.equal(existsSync(projectAgentsMdPath(projectRoot)), true);
		const text = await readFile(projectAgentsMdPath(projectRoot), "utf8");
		assert.match(text, /# 项目：领导交办 · 验收材料/);
		assert.match(text, /整理验收材料并提交/);
		assert.equal(existsSync(path.join(projectRoot, ".dsh-project-workbench", "board.json")), true);
		assert.equal(existsSync(path.join(projectRoot, ".dsh-project-workbench", "AGENTS.md")), true);
		const record = store._projects.get(result.project.id);
		assert.equal(record.dirName, result.project.dirName);
		assert.equal(record.rootPath, projectRoot);

		const settings = await service.getSettings();
		assert.equal(settings.workbenchRoot, root);
		assert.equal(settings.projectCount, 1);

		// 同名项目自动得到不同目录名
		const another = await service.createProject({ name: "领导交办 · 验收材料" });
		assert.notEqual(another.project.dirName, result.project.dirName);
		assert.equal(another.project.rootPath, path.join(root, another.project.dirName));

		// 自定义 folderName 仍是工作台根下的一级目录
		const custom = await service.createProject({ name: "自定义", folderName: "my-folder" });
		assert.equal(custom.project.dirName, "my-folder");
		assert.equal(custom.project.rootPath, path.join(root, "my-folder"));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("创建任务：自动建 tasks/<taskId> 目录；任务级 AGENTS.md 写在任务目录内", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "P" });
		const parent = await service.createTask({ projectId: project.project.id, title: "父任务", priority: "high", dueAt: "2026-12-31" });
		assert.equal(parent.task.status, "backlog");
		assert.equal(parent.task.priority, "high");
		assert.equal(parent.task.dueAt, new Date("2026-12-31").toISOString());
		assert.equal(parent.taskDir, taskDirPath(project.project.rootPath, parent.task.id));
		assert.equal(existsSync(parent.taskDir), true);

		const child = await service.createTask({ projectId: project.project.id, title: "子任务", parentId: parent.task.id, agentsMd: "# 只改 ch1\n" });
		assert.equal(child.task.parentId, parent.task.id);
		assert.equal(existsSync(child.taskDir), true);
		const agentsPath = taskAgentsMdPath(project.project.rootPath, child.task.id);
		assert.equal(agentsPath, path.join(child.taskDir, "AGENTS.md"));
		assert.equal(existsSync(agentsPath), true);
		assert.match(await readFile(agentsPath, "utf8"), /只改 ch1/);

		// 任务目录由 ID 决定，调用方传什么目录参数都不影响
		const forced = await service.createTask({ projectId: project.project.id, title: "不能指定目录", taskDir: "/tmp/evil", rootPath: "/tmp/evil" });
		assert.equal(forced.taskDir, taskDirPath(project.project.rootPath, forced.task.id));
		assert.equal(existsSync(forced.taskDir), true);

		const detail = await service.getTask(parent.task.id);
		assert.equal(detail.children.length, 1);
		assert.equal(detail.children[0].title, "子任务");
		await assert.rejects(() => service.createTask({ projectId: project.project.id, title: "坏优先级", priority: "p0" }), /priority/);
		await assert.rejects(() => service.createTask({ projectId: project.project.id, title: "坏时间", dueAt: "not-a-date" }), /截止时间/);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("needs-you 派生：未解决评论 / 阻塞 / 等待审核，底层状态不变", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "N" });
		const created = await service.createTask({ projectId: project.project.id, title: "写方案" });
		const taskId = created.task.id;

		const commented = await service.addTaskComment(taskId, { body: "这里需要确认口径", author: "agent" });
		assert.equal(commented.task.status, "backlog");
		assert.equal(commented.task.viewStatus, "needs-you");
		assert.equal(commented.needsYou, true);
		assert.equal(commented.needsYouReasons[0].code, "unresolved-comments");
		assert.equal(unresolvedCommentCount(commented.raw), 1);

		const resolved = await service.resolveTaskComment(taskId, commented.comment.id, { resolved: true });
		assert.equal(resolved.task.status, "backlog");
		assert.equal(resolved.task.viewStatus, "backlog");

		const blocked = await service.updateTask(taskId, { blocked: true });
		assert.equal(blocked.task.status, "backlog");
		assert.equal(blocked.task.viewStatus, "needs-you");
		assert.deepEqual(blocked.needsYouReasons.map((reason) => reason.code), ["blocked"]);

		const moved = await service.moveTask(taskId, "running");
		assert.equal(moved.task.status, "running");
		assert.equal(moved.task.blocked, false);
		assert.equal(moved.task.viewStatus, "running");

		const review = await service.updateTask(taskId, { waitingReview: true });
		assert.equal(review.task.viewStatus, "needs-you");
		assert.deepEqual(review.needsYouReasons.map((reason) => reason.code), ["waiting-review"]);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("updateTask 的 resolveComments 一次性解决全部评论并退出 needs-you", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "RC" });
		const task = await service.createTask({ projectId: project.project.id, title: "T" });
		await service.addTaskComment(task.task.id, { body: "第一条" });
		await service.addTaskComment(task.task.id, { body: "第二条" });
		const before = await service.getTask(task.task.id);
		assert.equal(before.viewStatus, "needs-you");
		assert.equal(before.task.unresolvedCommentCount, 2);
		const after = await service.updateTask(task.task.id, { resolveComments: true });
		assert.equal(after.task.viewStatus, "backlog");
		assert.equal(after.task.unresolvedCommentCount, 0);
		assert.ok(after.activity.some((entry) => entry.kind === "comment.resolved"));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("看板：四列、needs-you 不可拖入、从 needs-you 拖出会清标记/解决评论", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "B" });
		const a = await service.createTask({ projectId: project.project.id, title: "A" });
		const b = await service.createTask({ projectId: project.project.id, title: "B" });
		await service.updateTask(a.task.id, { blocked: true });
		const board = await service.board(project.project.id);
		assert.equal(board.workbenchRoot, project.workbenchRoot);
		assert.deepEqual(board.columns.map((column) => column.key), [...BOARD_COLUMNS]);
		assert.equal(board.columns.find((column) => column.key === "needs-you").droppable, false);
		assert.equal(board.columns.find((column) => column.key === "needs-you").tasks[0].id, a.task.id);
		await assert.rejects(() => service.moveTask(b.task.id, "needs-you"), /派生列/);
		await service.addTaskComment(a.task.id, { body: "还有一条未解决评论" });
		const moved = await service.moveTask(a.task.id, "done");
		assert.equal(moved.task.status, "done");
		assert.equal(moved.task.viewStatus, "done");
		assert.equal(moved.task.blocked, false);
		assert.equal(unresolvedCommentCount(moved.raw), 0);
		assert.ok(moved.task.completedAt !== null);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("状态更新：done 写 completedAt，回退清空；优先级/截止时间/描述可更新", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "U" });
		const task = await service.createTask({ projectId: project.project.id, title: "T" });
		const done = await service.updateTask(task.task.id, { status: "done", priority: "urgent", dueAt: "2027-01-01", description: "新描述" });
		assert.equal(done.task.status, "done");
		assert.ok(typeof done.task.completedAt === "string" && done.task.completedAt.length > 0);
		assert.equal(done.task.priority, "urgent");
		assert.equal(done.task.description, "新描述");
		const reopened = await service.updateTask(task.task.id, { status: "running", dueAt: "" });
		assert.equal(reopened.task.status, "running");
		assert.equal(reopened.task.completedAt, null);
		assert.equal(reopened.task.dueAt, null);
		assert.ok(reopened.activity.some((entry) => entry.kind === "task.status"));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("归档项目只读但可恢复；非空项目不可删除", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "A" });
		const task = await service.createTask({ projectId: project.project.id, title: "T" });
		const archived = await service.updateProject(project.project.id, { status: "archived" });
		assert.equal(archived.project.status, "archived");
		assert.ok(archived.project.archivedAt !== null);
		await assert.rejects(() => service.createTask({ projectId: project.project.id, title: "新任务" }), /已归档/);
		await assert.rejects(() => service.updateTask(task.task.id, { status: "running" }), /已归档/);
		await assert.rejects(() => service.addTaskComment(task.task.id, { body: "x" }), /已归档/);
		await assert.rejects(() => service.updateProject(project.project.id, { name: "改名" }), /已归档/);
		const activeList = await service.listProjects({ status: "active" });
		assert.equal(activeList.projects.some((item) => item.id === project.project.id), false);
		const allList = await service.listProjects({ status: "all" });
		assert.equal(allList.projects.some((item) => item.id === project.project.id), true);
		await assert.rejects(() => service.deleteProject(project.project.id), /非空项目不可删除/);
		const restored = await service.updateProject(project.project.id, { status: "active" });
		assert.equal(restored.project.status, "active");
		await service.moveTask(task.task.id, "done");
		await assert.rejects(() => service.deleteProject(project.project.id), /非空项目不可删除/);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("空项目可删除；删除后 storage 记录消失", async () => {
	const { service, store, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "E" });
		const deleted = await service.deleteProject(project.project.id);
		assert.equal(deleted.deleted, true);
		assert.equal(store._projects.get(project.project.id), undefined);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("任务级 AGENTS.md：继承关系可读，任务目录在 tasks/<taskId>", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "I", description: "项目背景" });
		const task = await service.createTask({
			projectId: project.project.id,
			title: "写验收报告",
			agentsMd: "# 本任务只改第三章\n\n- 只编辑 docs/ch3.md\n",
		});
		const taskDir = taskDirPath(project.project.rootPath, task.task.id);
		assert.equal(task.taskDir, taskDir);
		const agentsPath = path.join(taskDir, "AGENTS.md");
		assert.equal(existsSync(agentsPath), true);
		const content = await readFile(agentsPath, "utf8");
		assert.match(content, /只改第三章/);
		const detail = await service.getTask(task.task.id);
		assert.equal(detail.instructions.project.path, projectAgentsMdPath(project.project.rootPath));
		assert.equal(detail.instructions.project.exists, true);
		assert.equal(detail.instructions.task.path, agentsPath);
		assert.equal(detail.instructions.effectiveLayers.length, 2);
		assert.equal(detail.instructions.taskDir, taskDir);
		assert.equal(detail.instructions.loader, "@deepseek-ai/dsh-agent-instructions");
		const noTaskMd = await service.createTask({ projectId: project.project.id, title: "没有局部指令" });
		const noDetail = await service.getTask(noTaskMd.task.id);
		assert.equal(noDetail.instructions.task, null);
		assert.equal(noDetail.instructions.effectiveLayers.length, 1);
		assert.equal(existsSync(noDetail.taskDir), true);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("子目标：目录、会话关联、产物上传/同步/删除", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "G" });
		const task = await service.createTask({ projectId: project.project.id, title: "T", goal: "交付材料" });
		const created = await service.createGoal(task.task.id, { title: "收集证据", description: "合同与纪要" });
		const goal = created.goal;
		assert.equal(goal.status, "open");
		assert.equal(existsSync(goal.dir), true);
		assert.equal(existsSync(path.join(goal.dir, "inputs")), true);
		assert.equal(existsSync(path.join(goal.dir, "outputs")), true);

		const linked = await service.linkGoalSession(goal.id, { sessionId: "sess-1", title: "证据会话", cwd: goal.dir, status: "running" });
		assert.equal(linked.goal.sessionCount, 1);
		const linkId = linked.goal.sessions[0].id;
		const unlinked = await service.unlinkGoalSession(goal.id, linkId);
		assert.equal(unlinked.goal.sessionCount, 0);

		const uploaded = await service.uploadGoalArtifact(goal.id, { kind: "input", name: "证据.md", buffer: Buffer.from("# 证据\n") });
		assert.equal(uploaded.goal.inputCount, 1);
		assert.equal(existsSync(uploaded.artifact.path), true);
		assert.equal(uploaded.artifact.mime, "text/markdown; charset=utf-8");

		await writeFile(path.join(goal.dir, "outputs", "报告.md"), "# 报告\n", "utf8");
		const synced = await service.syncGoalArtifacts(goal.id);
		assert.equal(synced.added, 1);
		assert.equal(synced.goal.outputCount, 1);

		const deleted = await service.deleteGoalArtifact(goal.id, uploaded.artifact.id, { deleteFile: true });
		assert.equal(deleted.goal.inputCount, 0);
		assert.equal(existsSync(uploaded.artifact.path), false);

		const taskDetail = await service.getTask(task.task.id);
		assert.equal(taskDetail.goals.length, 1);
		assert.equal(taskDetail.task.goal, "交付材料");

		const updated = await service.updateGoal(goal.id, { status: "done" });
		assert.equal(updated.goal.status, "done");
		assert.ok(updated.goal.completedAt !== null);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("侧边栏角标：待处理/逾期/总任务数", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "Badge" });
		const task = await service.createTask({ projectId: project.project.id, title: "T" });
		const before = await service.getBadgeCounts();
		assert.equal(before.needsYou, 0);
		assert.equal(before.total, 1);
		await service.addTaskComment(task.task.id, { body: "请确认" });
		const after = await service.getBadgeCounts();
		assert.equal(after.needsYou, 1);
		assert.ok(after.overdue >= 0);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("首页 AI 助手会话：保存、刷新后读取、清空", async () => {
	const { service, tmp } = await makeService();
	try {
		const saved = await service.saveAssistantHistory([
			{ role: "user", content: "你好" },
			{ role: "assistant", content: "你好，工作台助手", actions: [{ tool: "workbench_get_dashboard", ok: true }] },
		]);
		assert.equal(saved.messages.length, 2);
		const loaded = await service.getAssistantHistory();
		assert.equal(loaded.messages.length, 2);
		assert.equal(loaded.messages[1].content, "你好，工作台助手");
		assert.equal(loaded.messages[1].actions.length, 1);
		const cleared = await service.clearAssistantHistory();
		assert.equal(cleared.cleared, true);
		assert.equal((await service.getAssistantHistory()).messages.length, 0);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("全部任务列表：跨项目任务、状态过滤、项目名", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "AT" });
		const task = await service.createTask({ projectId: project.project.id, title: "Task A" });
		const all = await service.listAllTasks();
		assert.ok(all.tasks.some((item) => item.id === task.task.id && item.projectName === "AT"));
		const done = await service.listAllTasks({ status: "done" });
		assert.equal(done.tasks.some((item) => item.id === task.task.id), false);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("首页 Dashboard：最近任务、项目进度、本周统计、关注事项、最近活动", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "D" });
		const overdue = await service.createTask({ projectId: project.project.id, title: "逾期任务", dueAt: "2000-01-01T00:00:00.000Z", priority: "high" });
		const dueToday = await service.createTask({ projectId: project.project.id, title: "今日任务", dueAt: new Date().toISOString() });
		const done = await service.createTask({ projectId: project.project.id, title: "已完成任务" });
		await service.moveTask(done.task.id, "done");
		await service.addTaskComment(overdue.task.id, { body: "需要确认" });
		const goal = await service.createGoal(overdue.task.id, { title: "G" });
		await service.uploadGoalArtifact(goal.goal.id, { kind: "output", name: "out.md", buffer: Buffer.from("x") });

		const dashboard = await service.getDashboard();
		assert.ok(dashboard.todayTasks.some((task) => task.id === overdue.task.id));
		assert.ok(dashboard.todayTasks.some((task) => task.id === dueToday.task.id));
		assert.ok(dashboard.recentTasks.some((task) => task.id === overdue.task.id));
		assert.ok(typeof dashboard.recentTasks[0].lastActivityAt === "string");
		assert.equal(dashboard.projects.length, 1);
		assert.equal(dashboard.projects[0].stats.total, 3);
		assert.ok(dashboard.projects[0].progress >= 33);
		assert.equal(dashboard.weekly.completed, 1);
		assert.ok(dashboard.weekly.artifacts >= 1);
		assert.ok(dashboard.focusItems.some((task) => task.id === overdue.task.id));
		assert.ok(dashboard.recentActivity.length >= 1);
		assert.ok(dashboard.recentActivity.some((entry) => entry.taskId === overdue.task.id));
		assert.ok(dashboard.insights.length >= 1);
		assert.equal(dashboard.stats.overdue >= 1, true);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("任务会话与任务成果：一任务一主会话、输入/输出成果记录", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "TS" });
		const task = await service.createTask({ projectId: project.project.id, title: "T", goal: "G" });
		const linked = await service.linkTaskSession(task.task.id, { sessionId: "session-1", title: "任务会话", cwd: project.workbenchRoot });
		assert.equal(linked.session.sessionId, "session-1");
		assert.equal(linked.task.sessionId, "session-1");

		const uploaded = await service.uploadTaskArtifact(task.task.id, { kind: "output", name: "报告.md", buffer: Buffer.from("# 报告\n") });
		assert.equal(uploaded.artifacts.length, 1);
		assert.equal(uploaded.artifacts[0].kind, "output");
		assert.equal(existsSync(uploaded.artifacts[0].path), true);
		assert.equal(uploaded.artifacts[0].downloadPath, `/workbench-api/artifacts/${uploaded.artifacts[0].id}/content`);

		const found = await service.getArtifact(uploaded.artifacts[0].id);
		assert.equal(found.task.id, task.task.id);

		await writeFile(path.join(path.dirname(uploaded.artifacts[0].path), "extra.md"), "# extra\n", "utf8");
		const synced = await service.syncTaskArtifacts(task.task.id);
		assert.ok(synced.added >= 1);
		assert.ok(synced.artifacts.length >= 2);

		const deleted = await service.deleteTaskArtifact(task.task.id, uploaded.artifacts[0].id, { deleteFile: true });
		assert.equal(deleted.artifacts.some((artifact) => artifact.id === uploaded.artifacts[0].id), false);
		assert.equal(existsSync(uploaded.artifacts[0].path), false);

		const unlinked = await service.unlinkTaskSession(task.task.id);
		assert.equal(unlinked.session, null);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("便携导出 board.json 含工作台根/项目目录/任务目录", async () => {
	const { service, tmp } = await makeService();
	try {
		const project = await service.createProject({ name: "Portable" });
		const task = await service.createTask({ projectId: project.project.id, title: "任务一" });
		const boardPath = path.join(project.project.rootPath, ".dsh-project-workbench", "board.json");
		const board = JSON.parse(await readFile(boardPath, "utf8"));
		assert.equal(board.format, "dsh-project-workbench/board");
		assert.equal(board.workbenchRoot, project.workbenchRoot);
		assert.equal(board.project.dirName, project.project.dirName);
		assert.equal(board.tasks.length, 1);
		assert.equal(board.tasks[0].viewStatus, "backlog");
		assert.equal(board.instructions.loader, "@deepseek-ai/dsh-agent-instructions");
		const manifest = await readFile(path.join(project.project.rootPath, ".dsh-project-workbench", "AGENTS.md"), "utf8");
		assert.match(manifest, /任务一/);
		assert.match(manifest, new RegExp(task.taskDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("修改工作台根目录：自动迁移项目、任务目录与记录 rootPath", async () => {
	const { service, store, tmp } = await makeService();
	try {
		const oldRoot = service.config.workbenchRoot;
		const project = await service.createProject({ name: "迁移项目", folderName: "migrate-me" });
		const task = await service.createTask({ projectId: project.project.id, title: "迁移任务", agentsMd: "# 局部指令\n" });
		const oldProjectRoot = project.project.rootPath;
		const oldTaskDir = task.taskDir;
		assert.equal(existsSync(path.join(oldTaskDir, "AGENTS.md")), true);

		const newRoot = path.join(tmp.dir, "workbench-v2");
		const result = await service.changeWorkbenchRoot(newRoot);
		assert.equal(result.workbenchRoot, newRoot);
		assert.equal(result.migrated, true);
		assert.equal(result.from, oldRoot);
		assert.equal(result.movedProjects, 1);
		const record = store._projects.get(project.project.id);
		assert.equal(record.rootPath, path.join(newRoot, "migrate-me"));
		assert.equal(existsSync(path.join(newRoot, "migrate-me", "AGENTS.md")), true);
		assert.equal(existsSync(path.join(newRoot, "migrate-me", "tasks", task.task.id, "AGENTS.md")), true);
		assert.equal(existsSync(oldProjectRoot), false);
		const detail = await service.getTask(task.task.id);
		assert.equal(detail.taskDir, path.join(newRoot, "migrate-me", "tasks", task.task.id));
		const settings = await service.getSettings();
		assert.equal(settings.workbenchRoot, newRoot);
		assert.equal(settings.source, "user");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("配置显式变更时（模拟重启）自动把旧根迁移到新配置根", async () => {
	const store = fakeStore();
	const tmp = await tempDir();
	try {
		const rootA = path.join(tmp.dir, "root-a");
		const rootB = path.join(tmp.dir, "root-b");
		const serviceA = new WorkbenchService({ store, config: { workbenchRoot: rootA, workbenchRootExplicit: true, exportPortableFiles: false }, cwd: tmp.dir });
		const project = await serviceA.createProject({ name: "重启迁移", folderName: "restart" });
		const task = await serviceA.createTask({ projectId: project.project.id, title: "T", agentsMd: "# x\n" });
		assert.equal(existsSync(path.join(rootA, "restart", "tasks", task.task.id, "AGENTS.md")), true);

		// 新 service 实例 + 新配置根，模拟重启后自动迁移
		const serviceB = new WorkbenchService({ store, config: { workbenchRoot: rootB, workbenchRootExplicit: true, exportPortableFiles: false }, cwd: tmp.dir });
		const settings = await serviceB.getSettings();
		assert.equal(settings.workbenchRoot, rootB);
		assert.equal(existsSync(path.join(rootB, "restart", "AGENTS.md")), true);
		assert.equal(existsSync(path.join(rootB, "restart", "tasks", task.task.id, "AGENTS.md")), true);
		assert.equal(existsSync(path.join(rootA, "restart")), false);
		const record = store._projects.get(project.project.id);
		assert.equal(record.rootPath, path.join(rootB, "restart"));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("旧版项目（无 dirName、外部 rootPath）首次启动被收养进工作台根目录", async () => {
	const { store, service, tmp, root } = await makeService();
	try {
		const external = path.join(tmp.dir, "legacy-external");
		await mkdir(external, { recursive: true });
		await writeFile(path.join(external, "AGENTS.md"), "# 旧项目\n", "utf8");
		const legacy = {
			id: "p-legacy",
			name: "旧项目",
			description: "",
			dirName: "",
			rootPath: external,
			status: "active",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			archivedAt: null,
		};
		await store._projects.put(legacy.id, legacy);
		const settings = await service.getSettings();
		assert.equal(settings.workbenchRoot, root);
		const record = store._projects.get(legacy.id);
		assert.ok(record.dirName.length > 0);
		assert.equal(record.rootPath, path.join(root, record.dirName));
		assert.equal(existsSync(path.join(record.rootPath, "AGENTS.md")), true);
		// 外部历史目录保留，避免误删用户数据
		assert.equal(existsSync(path.join(external, "AGENTS.md")), true);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("目录名清洗：buildProjectDirName 不产生路径分隔符", () => {
	assert.doesNotMatch(buildProjectDirName({ name: "../../etc/passwd", id: "p-1" }), /[\\/]/);
	assert.doesNotMatch(buildProjectDirName({ name: "x", id: "p-2", folderName: "../../evil" }), /[\\/]/);
	assert.match(buildProjectDirName({ name: "验收 材料", id: "p-abc12345" }), /^验收-材料-/);
});

runner.test("统计与派生纯函数", () => {
	const tasks = [
		{ status: "backlog", priority: "high", blocked: true, waitingReview: false, comments: [], dueAt: null, createdAt: "2026-01-01" },
		{ status: "running", priority: "medium", blocked: false, waitingReview: false, comments: [], dueAt: null, createdAt: "2026-01-02" },
		{ status: "done", priority: "low", blocked: false, waitingReview: true, comments: [], dueAt: null, createdAt: "2026-01-03" },
		{ status: "backlog", priority: "low", blocked: false, waitingReview: false, comments: [{ resolved: false }], dueAt: "2000-01-01", createdAt: "2026-01-04" },
	];
	assert.equal(isNeedsYou(tasks[0]), true);
	assert.equal(isNeedsYou(tasks[1]), false);
	assert.equal(viewStatusOf(tasks[2]), "needs-you");
	const stats = statsOf(tasks, "2026-01-05T00:00:00.000Z");
	assert.equal(stats.total, 4);
	assert.equal(stats.needsYou, 3);
	assert.equal(stats.running, 1);
	assert.equal(stats.done, 0);
	assert.equal(stats.overdue, 1);
	assert.equal(needsYouReasons(tasks[0])[0].code, "blocked");
	const sorted = [...tasks].sort(compareTasks);
	assert.equal(sorted[0].createdAt, "2026-01-01");
});

export default runner.run;
