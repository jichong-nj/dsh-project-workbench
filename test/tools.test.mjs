/**
 * test/tools.test.mjs — 7 个 defineTool 契约：名称、参数、结构化返回值与错误。
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { buildWorkbenchToolDefs, registerWorkbenchTools } from "../lib/tools.js";
import { WorkbenchService } from "../lib/service.js";
import { assert, createRunner, fakeStore, tempDir } from "./helpers.mjs";

const runner = createRunner("tools");

async function makeTools(progress) {
	const store = fakeStore();
	const tmp = await tempDir();
	const service = new WorkbenchService({
		store,
		config: { workbenchRoot: path.join(tmp.dir, "workbench"), workbenchRootExplicit: true, exportPortableFiles: false },
		cwd: tmp.dir,
	});
	const defs = buildWorkbenchToolDefs(service);
	const byName = new Map(defs.map((def) => [def.name, def]));
	const exec = async (name, args) => await byName.get(name).execute(args ?? {}, { signal: new AbortController().signal });
	return { service, defs, byName, exec, tmp };
}

runner.test("注册 13 个 workbench_* 工具，且都有参数/输出声明", async () => {
	const { defs, byName, tmp } = await makeTools();
	try {
		assert.deepEqual(
			defs.map((def) => def.name),
			[
				"workbench_list_projects",
				"workbench_get_project",
				"workbench_create_project",
				"workbench_create_task",
				"workbench_update_task",
				"workbench_create_goal",
				"workbench_get_goal",
				"workbench_update_goal",
				"workbench_add_goal_artifact",
				"workbench_add_task_artifact",
				"workbench_sync_task_artifacts",
				"workbench_get_task",
				"workbench_add_task_comment",
			],
		);
		for (const def of defs) {
			assert.equal(typeof def.description, "string");
			assert.ok(def.description.length > 10);
			assert.equal(typeof def.output?.render, "function");
			assert.ok(def.parameters !== undefined);
		}
		assert.ok(byName.has("workbench_get_task"));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("工具链路：创建项目 → 创建任务 → 评论 → 更新 → 读取", async () => {
	const { exec, tmp } = await makeTools();
	try {
		const createdProject = await exec("workbench_create_project", {
			name: "工具项目",
			description: "通过工具创建",
			rootPath: path.join(tmp.dir, "tool-project"),
		});
		assert.equal(createdProject.project.name, "工具项目");
		assert.equal(createdProject.agentsMd.created, true);

		const listed = await exec("workbench_list_projects", { status: "active" });
		assert.equal(listed.total, 1);
		assert.equal(listed.projects[0].stats.total, 0);

		const createdTask = await exec("workbench_create_task", {
			projectId: createdProject.project.id,
			title: "整理证据",
			description: "把合同和纪要归档",
			priority: "high",
		});
		assert.equal(createdTask.task.status, "backlog");
		assert.equal(createdTask.task.priority, "high");

		const commented = await exec("workbench_add_task_comment", {
			taskId: createdTask.task.id,
			body: "缺少 2025 年合同扫描件",
			author: "agent",
		});
		assert.equal(commented.needsYou, true);
		assert.equal(commented.task.viewStatus, "needs-you");

		const updated = await exec("workbench_update_task", { taskId: createdTask.task.id, priority: "urgent", status: "running" });
		assert.equal(updated.task.status, "running");
		assert.equal(updated.task.priority, "urgent");
		// 未解决评论仍在 → 仍是 needs-you
		assert.equal(updated.task.viewStatus, "needs-you");

		const detail = await exec("workbench_get_task", { taskId: createdTask.task.id });
		assert.equal(detail.task.title, "整理证据");
		assert.equal(detail.project.name, "工具项目");
		assert.equal(detail.comments.length, 1);
		assert.ok(detail.activity.some((entry) => entry.kind === "task.created"));
		assert.equal(detail.instructions.project.exists, true);
		assert.equal(detail.instructions.task, null);

		const projectDetail = await exec("workbench_get_project", { projectId: createdProject.project.id, taskStatus: "needs-you" });
		assert.equal(projectDetail.tasks.length, 1);
		assert.equal(projectDetail.project.stats.needsYou, 1);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("工具链路：任务目标 → 子目标 → 产物登记", async () => {
	const { exec, tmp } = await makeTools();
	try {
		const project = await exec("workbench_create_project", { name: "目标项目", folderName: "goals", rootPath: "/ignored" });
		const task = await exec("workbench_create_task", { projectId: project.project.id, title: "T", goal: "交付一份验收材料" });
		assert.equal(task.task.goal, "交付一份验收材料");
		const goal = await exec("workbench_create_goal", { taskId: task.task.id, title: "收集证据", description: "合同与纪要" });
		assert.equal(goal.goal.status, "open");
		assert.ok(goal.goal.dir.includes("/goals/"));
		const file = path.join(tmp.dir, "evidence.md");
		await writeFile(file, "# evidence\n", "utf8");
		const artifact = await exec("workbench_add_goal_artifact", { goalId: goal.goal.id, kind: "input", path: file, name: "证据.md" });
		assert.equal(artifact.goal.inputCount, 1);
		assert.equal(artifact.artifact.name, "证据.md");
		const detail = await exec("workbench_get_goal", { goalId: goal.goal.id });
		assert.equal(detail.goal.artifacts[0].downloadPath, `/workbench-api/artifacts/${artifact.artifact.id}/content`);
		const updated = await exec("workbench_update_goal", { goalId: goal.goal.id, status: "doing" });
		assert.equal(updated.goal.status, "doing");
		const taskArtifact = await exec("workbench_add_task_artifact", { taskId: task.task.id, kind: "output", path: file, name: "任务成果.md" });
		assert.equal(taskArtifact.artifacts.length, 1);
		const synced = await exec("workbench_sync_task_artifacts", { taskId: task.task.id });
		assert.ok(Array.isArray(synced.artifacts));
	} finally {
		await tmp.cleanup();
	}
});

runner.test("工具错误：not-found / invalid-status / needs-you 写入均返回可读错误", async () => {
	const { exec, tmp } = await makeTools();
	try {
		await assert.rejects(() => exec("workbench_get_project", { projectId: "p-missing" }), /\[not-found\].*项目不存在/);
		await assert.rejects(() => exec("workbench_create_project", { name: "  " }), /\[invalid-input\].*name/);
		const project = await exec("workbench_create_project", { name: "E", rootPath: path.join(tmp.dir, "e") });
		// defineTool 在 execute 前做参数校验，所以非法枚举得到可读的 ToolArgsError
		await assert.rejects(
			() => exec("workbench_create_task", { projectId: project.project.id, title: "T", priority: "nope" }),
			/invalid arguments/,
		);
		const task = await exec("workbench_create_task", { projectId: project.project.id, title: "T" });
		await assert.rejects(() => exec("workbench_update_task", { taskId: task.task.id, status: "needs-you" }), /invalid arguments/);
		await assert.rejects(() => exec("workbench_get_task", { taskId: "t-missing" }), /\[not-found\]/);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("registerWorkbenchTools 使用 ctx.tools.register 并返回清理函数", async () => {
	const { service, tmp } = await makeTools();
	try {
		const registered = [];
		let disposed = 0;
		const ctx = {
			tools: {
				register(def) {
					registered.push(def);
					return () => {
						disposed += 1;
					};
				},
			},
			logger: { warn: () => undefined },
		};
		const dispose = registerWorkbenchTools(ctx, service);
		assert.equal(registered.length, 13);
		assert.equal(typeof dispose, "function");
		dispose();
		assert.equal(disposed, 13);
		// 缺 tools 服务时不抛错
		assert.equal(typeof registerWorkbenchTools({}, service), "function");
	} finally {
		await tmp.cleanup();
	}
});

export default runner.run;
