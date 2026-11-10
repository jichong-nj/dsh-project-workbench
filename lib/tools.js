/**
 * lib/tools.js — 注册 11 个 workbench_* 智能体工具。
 *
 * 使用 @deepseek-ai/dsh-tools 的 defineTool 声明参数/输出，通过 ctx.tools.register
 * 挂载；所有写操作都落到 WorkbenchService（storageDomain），工具本身不写文件。
 *
 * 返回：canonical 值是结构化 JSON；render 把它作为可读 JSON 文本交给模型。
 * 错误：抛出带 `[code] message` 的 Error，由工具运行器转成普通错误结果。
 *
 * @module lib/tools
 */

import { defineTool } from "@deepseek-ai/dsh-tools";

import { toErrorInfo } from "./errors.js";

/** 输出 JSON 文本上限，避免单个工具结果撑爆上下文。 */
const MAX_RENDER_CHARS = 24000;

/** 所有工具共用的宽松输出 schema：canonical 值都是 JSON 对象。 */
const OBJECT_OUTPUT = { type: "object", additionalProperties: true };

/** 把 canonical 值渲染成可读 JSON 文本。 */
function renderValue(_args, value) {
	let text;
	try {
		text = JSON.stringify(value, null, 2);
	} catch {
		text = String(value);
	}
	if (typeof text !== "string") text = String(text);
	if (text.length > MAX_RENDER_CHARS) {
		text = `${text.slice(0, MAX_RENDER_CHARS)}\n…（结果过长，已截断；完整数据可通过 HTTP /workbench-api 获取）`;
	}
	return [{ type: "text", text }];
}

/** 统一错误出口：保留稳定 code，message 给人和模型读。 */
function toolError(error) {
	const info = toErrorInfo(error);
	const wrapped = new Error(`[${info.code}] ${info.message}`);
	wrapped.cause = error;
	return wrapped;
}

/** 包一层 execute：把业务错误翻译成可读失败。 */
function guard(fn) {
	return async (...args) => {
		try {
			return await fn(...args);
		} catch (error) {
			throw toolError(error);
		}
	};
}

/**
 * 构造 11 个工具定义（便于测试直接检查）。
 * @param {import('./service.js').WorkbenchService} service
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition[]}
 */
export function buildWorkbenchToolDefs(service) {
	return [
		defineTool({
			name: "workbench_list_projects",
			description:
				"列出工作台项目（默认只看活跃项目），返回 id、名称、状态、项目目录、工作台根目录与任务统计（backlog / running / needs-you / done）。",
			parameters: {
				status: {
					type: "string",
					enum: ["active", "archived", "all"],
					description: "项目状态筛选，默认 active；all 表示含已归档",
				},
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				const result = await service.listProjects({ status: args.status ?? "active" });
				return {
					total: result.total,
					workbenchRoot: result.workbenchRoot,
					projects: result.projects.map((project) => ({
						id: project.id,
						name: project.name,
						status: project.status,
						dirName: project.dirName,
						rootPath: project.rootPath,
						stats: project.stats,
						createdAt: project.createdAt,
						updatedAt: project.updatedAt,
						agentsMdPath: project.agentsMdPath,
					})),
				};
			}),
		}),

		defineTool({
			name: "workbench_get_project",
			description:
				"读取一个项目的详情与其任务列表（可按派生状态筛选：all / backlog / running / needs-you / done），并返回项目统计与项目级 AGENTS.md 路径。",
			parameters: {
				projectId: { type: "string", required: true, description: "项目 id（p-…）" },
				taskStatus: {
					type: "string",
					enum: ["all", "backlog", "running", "needs-you", "done"],
					description: "任务筛选，默认 all；needs-you 是派生视图",
				},
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				return await service.getProject(args.projectId, { taskStatus: args.taskStatus ?? "all" });
			}),
		}),

		defineTool({
			name: "workbench_create_project",
			description:
				"创建项目：项目目录自动建在工作台根目录下（不接受任意 rootPath），并在其中生成/确认项目级 AGENTS.md（已存在则保留不动）。",
			parameters: {
				name: { type: "string", required: true, description: "项目名称" },
				description: { type: "string", description: "项目目标/背景描述，会写入项目 AGENTS.md 骨架" },
				folderName: { type: "string", description: "可选：工作台根下的一级目录名；缺省用“名称-slug + ID 后缀”" },
				agentsMd: { type: "string", description: "自定义项目级 AGENTS.md 模板内容；缺省使用插件内置模板" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				return await service.createProject({
					name: args.name,
					description: args.description,
					folderName: args.folderName,
					agentsMd: args.agentsMd,
					actor: "agent",
				});
			}),
		}),

		defineTool({
			name: "workbench_create_task",
			description:
				"在指定项目下创建任务（默认 backlog），自动创建任务目录 tasks/<taskId>/；可指定父任务形成任务树、优先级与截止时间；如需任务级局部指令，传 agentsMd 生成该任务目录下的增量 AGENTS.md。",
			parameters: {
				projectId: { type: "string", required: true, description: "所属项目 id" },
				title: { type: "string", required: true, description: "任务标题" },
				description: { type: "string", description: "任务描述" },
				goal: { type: "string", description: "任务目标（一句话说清要达成什么）" },
				parentId: { type: "string", description: "可选父任务 id（同一项目内）" },
				priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "优先级，默认 medium" },
				dueAt: { type: "string", description: "截止时间，ISO 8601 字符串" },
				agentsMd: { type: "string", description: "可选任务级 AGENTS.md 内容（只写增量，不重复项目级）" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				return await service.createTask({
					projectId: args.projectId,
					title: args.title,
					description: args.description,
					goal: args.goal,
					parentId: args.parentId,
					priority: args.priority,
					dueAt: args.dueAt,
					agentsMd: args.agentsMd,
					actor: "agent",
				});
			}),
		}),

		defineTool({
			name: "workbench_update_task",
			description:
				"更新任务状态/优先级/截止时间/标题/描述，或标记/解除阻塞与等待审核。注意 needs-you 是派生视图，不能直接写入；它由未解决评论、阻塞或等待审核自动进入。",
			parameters: {
				taskId: { type: "string", required: true, description: "任务 id（t-…）" },
				status: { type: "string", enum: ["backlog", "running", "done"], description: "底层 workflow 状态" },
				priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "优先级" },
				dueAt: { type: "string", description: "截止时间（ISO 8601）；空串表示清空" },
				title: { type: "string", description: "新标题" },
				description: { type: "string", description: "新描述" },
				goal: { type: "string", description: "新任务目标" },
				blocked: { type: "boolean", description: "是否标记为阻塞（true 会进入 needs-you）" },
				waitingReview: { type: "boolean", description: "是否等待审核（true 会进入 needs-you）" },
				resolveComments: { type: "boolean", description: "true = 一次性解决该任务全部未解决评论（让任务退出 comment 引起的 needs-you）" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				const patch = {};
				for (const key of ["status", "priority", "dueAt", "title", "description", "goal", "blocked", "waitingReview", "resolveComments"]) {
					if (args[key] !== undefined) patch[key] = args[key];
				}
				return await service.updateTask(args.taskId, { ...patch, actor: "agent" });
			}),
		}),

		defineTool({
			name: "workbench_create_goal",
			description:
				"在任务下创建子目标：自动建立 goals/<goalId>/{inputs,outputs} 目录，用于组织多个会话与输入/输出产物。",
			parameters: {
				taskId: { type: "string", required: true, description: "任务 id（t-…）" },
				title: { type: "string", required: true, description: "子目标标题" },
				description: { type: "string", description: "子目标描述/验收标准" },
				status: { type: "string", enum: ["open", "doing", "done"], description: "状态，默认 open" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				return await service.createGoal(args.taskId, { title: args.title, description: args.description, status: args.status, actor: "agent" });
			}),
		}),

		defineTool({
			name: "workbench_get_goal",
			description: "读取子目标详情：目录、状态、已关联会话、输入/输出产物（含下载路径）。",
			parameters: {
				goalId: { type: "string", required: true, description: "子目标 id（g-…）" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => await service.getGoal(args.goalId)),
		}),

		defineTool({
			name: "workbench_update_goal",
			description: "更新子目标标题/描述/状态/排序。",
			parameters: {
				goalId: { type: "string", required: true, description: "子目标 id（g-…）" },
				title: { type: "string", description: "新标题" },
				description: { type: "string", description: "新描述" },
				status: { type: "string", enum: ["open", "doing", "done"], description: "新状态" },
				order: { type: "integer", description: "排序序号" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				const patch = { actor: "agent" };
				for (const key of ["title", "description", "status", "order"]) if (args[key] !== undefined) patch[key] = args[key];
				return await service.updateGoal(args.goalId, patch);
			}),
		}),

		defineTool({
			name: "workbench_add_goal_artifact",
			description:
				"把已存在的本地文件登记为子目标产物（输入或输出），不复制文件；下载/管理走 /workbench-api。",
			parameters: {
				goalId: { type: "string", required: true, description: "子目标 id（g-…）" },
				kind: { type: "string", enum: ["input", "output"], required: true, description: "产物类型" },
				path: { type: "string", required: true, description: "文件绝对路径" },
				name: { type: "string", description: "展示名，默认文件名" },
				note: { type: "string", description: "备注" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				return await service.linkGoalArtifact(args.goalId, { kind: args.kind, path: args.path, name: args.name, note: args.note, actor: "agent" });
			}),
		}),

		defineTool({
			name: "workbench_add_task_artifact",
			description: "把任务会话/agent 产生的已有文件登记为任务级输入或输出成果（不复制文件），供任务详情统一管理。",
			parameters: {
				taskId: { type: "string", required: true, description: "任务 id（t-…）" },
				kind: { type: "string", enum: ["input", "output"], required: true, description: "成果类型" },
				path: { type: "string", required: true, description: "文件绝对路径" },
				name: { type: "string", description: "展示名，默认文件名" },
				note: { type: "string", description: "备注" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => await service.linkTaskArtifact(args.taskId, { kind: args.kind, path: args.path, name: args.name, note: args.note, actor: "agent" })),
		}),

		defineTool({
			name: "workbench_sync_task_artifacts",
			description: "扫描任务目录 tasks/<taskId>/{inputs,outputs}，把其中尚未登记的成果文件补登记到任务。",
			parameters: {
				taskId: { type: "string", required: true, description: "任务 id（t-…）" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => await service.syncTaskArtifacts(args.taskId)),
		}),

		defineTool({
			name: "workbench_get_task",
			description:
				"读取任务详情：所属项目、父任务与子任务、评论、活动记录、派生 needs-you 原因，以及当前生效的 AGENTS.md 指令层路径（项目级 + 任务级）。",
			parameters: {
				taskId: { type: "string", required: true, description: "任务 id（t-…）" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				const detail = await service.getTask(args.taskId);
				return {
					task: detail.task,
					needsYou: detail.needsYou,
					needsYouReasons: detail.needsYouReasons,
					viewStatus: detail.viewStatus,
					project: detail.project,
					parent: detail.parent,
					children: detail.children,
					taskDir: detail.taskDir,
					workbenchRoot: detail.workbenchRoot,
					comments: detail.comments,
					goals: detail.goals,
					activity: detail.activity,
					instructions: detail.instructions,
					stats: detail.stats,
				};
			}),
		}),

		defineTool({
			name: "workbench_add_task_comment",
			description:
				"给任务添加评论/备注（默认未解决，会让任务进入 needs-you 等待人工处理）；resolved=true 表示添加一条已解决评论。",
			parameters: {
				taskId: { type: "string", required: true, description: "任务 id（t-…）" },
				body: { type: "string", required: true, description: "评论正文" },
				author: { type: "string", description: "评论作者，默认 user（agent 调用建议传 agent）" },
				resolved: { type: "boolean", description: "是否直接标记为已解决，默认 false" },
			},
			output: { schema: OBJECT_OUTPUT, render: renderValue },
			execute: guard(async (args) => {
				const result = await service.addTaskComment(args.taskId, {
					body: args.body,
					author: args.author ?? "agent",
					resolved: args.resolved === true,
					actor: "agent",
				});
				return {
					comment: result.comment,
					task: result.task,
					needsYou: result.needsYou,
					needsYouReasons: result.needsYouReasons,
					viewStatus: result.viewStatus,
					stats: result.stats,
				};
			}),
		}),
	];
}

/**
 * 注册 workbench_* 工具。
 * @param {{ tools?: { register: Function } }} ctx
 * @param {import('./service.js').WorkbenchService} service
 * @returns {() => void} disposer
 */
export function registerWorkbenchTools(ctx, service) {
	const tools = ctx?.tools;
	if (tools === undefined || tools === null || typeof tools.register !== "function") return () => {};
	const disposers = [];
	for (const def of buildWorkbenchToolDefs(service)) {
		try {
			const dispose = tools.register(def);
			if (typeof dispose === "function") disposers.push(dispose);
		} catch (error) {
			ctx?.logger?.warn?.(`[project-workbench] tool register failed (${def.name}): ${String(error?.stack ?? error)}`);
		}
	}
	return () => {
		for (const dispose of disposers) {
			try {
				dispose();
			} catch {
				/* 忽略清理失败 */
			}
		}
	};
}
