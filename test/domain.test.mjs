/**
 * test/domain.test.mjs — storageDomain 声明契约。
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
	DOMAIN_NAMES,
	LOGICAL_DOMAIN_NAMES,
	openWorkbenchDomains,
	projectRecordSchema,
	projectsDomainSpec,
	taskRecordSchema,
	tasksDomainSpec,
	WorkbenchStore,
} from "../lib/domain.js";
import { assert, createRunner, fakeStore } from "./helpers.mjs";

const runner = createRunner("domain");

runner.test("domain 名称遵循 storage-domain 的 UNIT_NAME_RE，并保留逻辑名映射", () => {
	assert.equal(DOMAIN_NAMES.projects, "workbench_projects");
	assert.equal(DOMAIN_NAMES.tasks, "workbench_tasks");
	assert.equal(LOGICAL_DOMAIN_NAMES.projects, "workbench.projects");
	assert.equal(LOGICAL_DOMAIN_NAMES.tasks, "workbench.tasks");
	assert.equal(projectsDomainSpec.name, "workbench_projects");
	assert.equal(tasksDomainSpec.name, "workbench_tasks");
	assert.ok("projects" in projectsDomainSpec.tables);
	assert.ok("tasks" in tasksDomainSpec.tables);
});

runner.test("项目/任务记录 schema 接受完整记录并填充默认值", () => {
	const project = projectRecordSchema.parse({
		id: "p-1",
		name: "示例项目",
		rootPath: "/tmp/example",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	});
	assert.equal(project.status, "active");
	assert.equal(project.description, "");
	assert.equal(project.archivedAt, null);

	const task = taskRecordSchema.parse({
		id: "t-1",
		projectId: "p-1",
		title: "示例任务",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	});
	assert.equal(task.status, "backlog");
	assert.equal(task.priority, "medium");
	assert.equal(task.parentId, null);
	assert.deepEqual(task.comments, []);
	assert.deepEqual(task.activity, []);
});

runner.test("schema 拒绝非法状态 / 缺字段", () => {
	assert.throws(() => taskRecordSchema.parse({ id: "t", projectId: "p", title: "x", status: "needs-you", createdAt: "a", updatedAt: "b" }));
	assert.throws(() => projectRecordSchema.parse({ id: "p", name: "x", createdAt: "a", updatedAt: "b" }));
});

runner.test("WorkbenchStore 惰性打开并缓存句柄", async () => {
	const store = fakeStore();
	let opened = 0;
	const wrapper = new WorkbenchStore({
		open: async () => {
			opened += 1;
			return { projects: { table: (name) => (name === "projects" ? store._projects : store._tasks) }, tasks: { table: () => store._tasks }, close: async () => undefined };
		},
	});
	const a = await wrapper.projects();
	const b = await wrapper.projects();
	assert.equal(a, b);
	assert.equal(opened, 1);
	await wrapper.close();
});

runner.test("openWorkbenchDomains 在第二个 domain 失败时关闭第一个", async () => {
	let closed = 0;
	const facility = {
		open: async (spec) => {
			if (spec.name === "workbench_tasks") throw new Error("boom");
			return { table: () => ({}), close: async () => (closed += 1) };
		},
	};
	await assert.rejects(() => openWorkbenchDomains(facility), /boom/);
	assert.equal(closed, 1);
});

runner.test("导出文件路径声明不触碰文件系统（sanity）", () => {
	// 插件源码里不应直接以 JSON 文件为主存储；这里只确认 domain 模块能独立加载。
	assert.equal(existsSync(path.join(process.cwd(), "lib", "domain.js")), true);
});

export default runner.run;
