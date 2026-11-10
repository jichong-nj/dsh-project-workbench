/**
 * lib/assistant.js — Dashboard 右侧 AI 对话（带工作台工具调用）。
 *
 * 与“打开一个新会话”不同：这里是由 host 直接调用 ctx.llm，并在同一轮对话里
 * 执行工作台工具（创建项目/任务/子目标、查询项目/任务/首页等），因此用户
 * 不离开首页就能完成操作。工具执行复用 WorkbenchService，仍走 storageDomain。
 *
 * 协议：native function calling（llm.stream 的 tools + tool-call-delta），
 * 最多 4 轮工具调用，避免死循环。
 *
 * @module lib/assistant
 */

import { createAssistantMessage, createToolResultMessage } from "@deepseek-ai/dsh-llm";

import { fail } from "./errors.js";

/** 单个工具结果回传给模型的字符上限。 */
const MAX_TOOL_RESULT_CHARS = 12000;

/** 最多工具轮次。 */
const MAX_TOOL_ROUNDS = 4;

/** 模型调用超时。 */
const CALL_TIMEOUT_MS = 120000;

/** 工具定义（JSON Schema 直接给 provider；execute 调 WorkbenchService）。 */
function toolDefinitions(service) {
	return [
		{
			name: "workbench_get_dashboard",
			description: "读取工作台首页聚合数据：今日待办、进行中项目进度、本周统计、关注事项、最近活动。用于回答“今天要做什么/进度如何/最近发生了什么”。",
			parameters: { type: "object", properties: {}, additionalProperties: false },
			async run() {
				return await service.getDashboard();
			},
		},
		{
			name: "workbench_list_projects",
			description: "列出工作台项目（含任务统计）。status 默认 active；回答“有哪些项目”时使用。",
			parameters: {
				type: "object",
				properties: {
					status: { type: "string", enum: ["active", "archived", "all"], description: "状态筛选，默认 active" },
				},
				additionalProperties: false,
			},
			async run(args) {
				return await service.listProjects({ status: args.status ?? "active" });
			},
		},
		{
			name: "workbench_get_project",
			description: "读取项目详情与任务列表；需要 projectId。可按 taskStatus 筛选任务。",
			parameters: {
				type: "object",
				properties: {
					projectId: { type: "string", description: "项目 id（p-…）" },
					taskStatus: { type: "string", enum: ["all", "backlog", "running", "needs-you", "done"] },
				},
				required: ["projectId"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.getProject(args.projectId, { taskStatus: args.taskStatus ?? "all" });
			},
		},
		{
			name: "workbench_create_project",
			description: "创建项目。项目目录自动建在工作台根目录下，不需要用户指定 rootPath。",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string", description: "项目名称" },
					description: { type: "string", description: "项目目标/背景" },
					folderName: { type: "string", description: "可选：工作台根下的一级目录名" },
				},
				required: ["name"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.createProject({ ...args, actor: "agent" });
			},
		},
		{
			name: "workbench_create_task",
			description: "在指定项目下创建任务（自动建任务目录）。需要 projectId 和 title；可带 goal/description/priority/dueAt。",
			parameters: {
				type: "object",
				properties: {
					projectId: { type: "string" },
					title: { type: "string" },
					goal: { type: "string", description: "任务目标（一句话）" },
					description: { type: "string" },
					parentId: { type: "string" },
					priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
					dueAt: { type: "string", description: "ISO 8601 截止时间" },
				},
				required: ["projectId", "title"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.createTask({ ...args, actor: "agent" });
			},
		},
		{
			name: "workbench_update_task",
			description: "更新任务状态/优先级/截止时间/标题/描述/任务目标，或解决全部评论（resolveComments）。needs-you 是派生状态，不能直接写。",
			parameters: {
				type: "object",
				properties: {
					taskId: { type: "string" },
					status: { type: "string", enum: ["backlog", "running", "done"] },
					priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
					dueAt: { type: "string" },
					title: { type: "string" },
					description: { type: "string" },
					goal: { type: "string" },
					blocked: { type: "boolean" },
					waitingReview: { type: "boolean" },
					resolveComments: { type: "boolean" },
				},
				required: ["taskId"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.updateTask(args.taskId, { ...args, actor: "agent" });
			},
		},
		{
			name: "workbench_get_task",
			description: "读取任务详情（目标、子目标、评论、活动、指令层）。",
			parameters: {
				type: "object",
				properties: { taskId: { type: "string" } },
				required: ["taskId"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.getTask(args.taskId);
			},
		},
		{
			name: "workbench_create_goal",
			description: "在任务下创建子目标。",
			parameters: {
				type: "object",
				properties: {
					taskId: { type: "string" },
					title: { type: "string" },
					description: { type: "string" },
					status: { type: "string", enum: ["open", "doing", "done"] },
				},
				required: ["taskId", "title"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.createGoal(args.taskId, { ...args, actor: "agent" });
			},
		},
		{
			name: "workbench_add_task_comment",
			description: "给任务添加评论（默认未解决，任务进入 needs-you）。",
			parameters: {
				type: "object",
				properties: {
					taskId: { type: "string" },
					body: { type: "string" },
					resolved: { type: "boolean" },
				},
				required: ["taskId", "body"],
				additionalProperties: false,
			},
			async run(args) {
				return await service.addTaskComment(args.taskId, { body: args.body, resolved: args.resolved === true, author: "agent", actor: "agent" });
			},
		},
	];
}

/** 把工具定义转成 provider 需要的 schema。 */
function toolSchemas(defs) {
	return defs.map((def) => ({ name: def.name, description: def.description, parameters: def.parameters }));
}

/** 取文本结果。 */
function textContent(text) {
	return [{ type: "text", text: String(text ?? "") }];
}

/**
 * 创建 Assistant 服务。
 * @param {{
 *   service: import('./service.js').WorkbenchService,
 *   getLlm: () => any,
 *   getDefaultModel: () => any,
 *   logger?: object,
 * }} options
 */
export function createAssistantService({ service, getLlm, getDefaultModel, logger }) {
	async function resolveSelection() {
		const llm = getLlm();
		if (llm === null || llm === undefined) throw fail("model-unavailable", "AI 助手暂不可用：DSH 的 LLM 服务尚未加载。");
		const providers = llm.listProviders();
		if (!Array.isArray(providers) || providers.length === 0) throw fail("model-unavailable", "没有已注册的模型提供方，请先在 DSH 设置中配置模型。");
		const ids = new Set(providers.map((entry) => entry.id));
		let preferred = null;
		try {
			const selection = getDefaultModel()?.currentSelection?.();
			if (selection !== null && selection !== undefined && ids.has(selection.provider)) preferred = { provider: selection.provider, model: selection.model };
		} catch {
			/* ignore */
		}
		const provider = preferred?.provider ?? providers[0].id;
		let models = [];
		try {
			models = await llm.listModels(provider);
		} catch {
			models = [];
		}
		const model = preferred !== null && models.some((entry) => entry.id === preferred.model) ? preferred.model : models[0]?.id;
		if (typeof model !== "string" || model === "") throw fail("model-unavailable", "没有可用模型：模型提供方没有返回模型列表。");
		return { provider, model };
	}

	async function invokeTool(defs, name, rawArgs) {
		const def = defs.find((item) => item.name === name);
		if (def === undefined) throw new Error(`未知工具：${name}`);
		let args = {};
		try {
			args = typeof rawArgs === "string" && rawArgs.trim() !== "" ? JSON.parse(rawArgs) : {};
		} catch {
			throw new Error(`工具 ${name} 参数不是合法 JSON`);
		}
		return await def.run(args);
	}

	async function chat({ message, history = [], signal }) {
		const llm = getLlm();
		if (llm === null || llm === undefined) throw fail("model-unavailable", "AI 助手暂不可用：DSH 的 LLM 服务尚未加载。");
		const text = typeof message === "string" ? message.trim() : "";
		if (text === "") throw fail("invalid-input", "消息不能为空");
		const selection = await resolveSelection();
		const defs = toolDefinitions(service);
		const schemas = toolSchemas(defs);
		const dashboard = await service.getDashboard();
		const projects = await service.listProjects({ status: "all" });
		const contextLines = [
			`工作台根：${dashboard.workbenchRoot}`,
			`项目（${projects.total}）：`,
			...projects.projects.slice(0, 20).map((project) => `- ${project.id} ${project.name} [${project.status}] 任务 ${project.stats.total}（running ${project.stats.running}/needs-you ${project.stats.needsYou}/done ${project.stats.done}）`),
			`今日/逾期任务：${dashboard.todayTasks.length === 0 ? "无" : dashboard.todayTasks.map((task) => `${task.projectName}/${task.title}(${task.viewStatus})`).join("；")}`,
			`关注事项：${dashboard.focusItems.length === 0 ? "无" : dashboard.focusItems.map((task) => `${task.projectName}/${task.title}(${task.viewStatus})`).join("；")}`,
		];
		const system = [
			"你是 dsh-project-workbench 的工作台 AI 助手，帮助用户查看和操作项目、任务、子目标。",
			"你可以调用工具查询或创建数据。用户明确表达创建/修改意图时直接执行，不要反复确认；缺少必需参数时先查询或追问。",
			"不要编造 id；需要 id 时先调用查询工具。回复使用中文，简洁清晰；执行完操作后用一两句话汇报结果。",
			"needs-you 是派生状态，不能直接写入；任务底层状态只有 backlog/running/done。",
			"",
			"当前工作台快照：",
			...contextLines,
		].join("\n");

		const messages = [];
		for (const item of Array.isArray(history) ? history.slice(-10) : []) {
			if (item === null || item === undefined) continue;
			const content = typeof item.content === "string" ? item.content : "";
			if (content.trim() === "") continue;
			if (item.role === "assistant") {
				messages.push(createAssistantMessage({ content: textContent(content), source: { kind: "model", provider: selection.provider, model: selection.model } }));
			} else {
				messages.push({ role: "user", content: textContent(content) });
			}
		}
		messages.push({ role: "user", content: textContent(text) });

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(new Error("AI 助手调用超时")), CALL_TIMEOUT_MS);
		const signals = [controller.signal];
		if (signal instanceof AbortSignal) signals.push(signal);
		const fused = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
		const actions = [];

		try {
			for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
				let textOut = "";
				const calls = new Map();
				let finish = null;
				const stream = llm.stream({
					provider: selection.provider,
					model: selection.model,
					system,
					messages,
					tools: schemas,
					maxTokens: 2048,
					signal: fused,
				});
				for await (const chunk of stream) {
					if (chunk.type === "text-delta") textOut += chunk.text;
					else if (chunk.type === "tool-call-delta") {
						const current = calls.get(chunk.index) ?? { id: chunk.id, name: "", args: "" };
						if (typeof chunk.name === "string" && chunk.name !== "") current.name = chunk.name;
						current.args += chunk.argumentsDelta;
						current.id = chunk.id;
						calls.set(chunk.index, current);
					} else if (chunk.type === "finish") finish = chunk;
				}
				const reason = finish?.reason ?? null;
				if (reason !== null && reason.kind !== "stop" && reason.kind !== "tool-calls" && reason.kind !== "max-tokens") {
					const detail = reason.failure?.message ?? JSON.stringify(finish).slice(0, 300);
					throw fail("model-call-failed", `AI 助手调用失败：${detail}`);
				}
				const callList = [...calls.values()].filter((call) => call.name !== "");
				if (callList.length === 0) {
					return {
						reply: textOut.trim() === "" ? "已处理。" : textOut.trim(),
						actions,
						provider: selection.provider,
						model: selection.model,
					};
				}

				const assistantBlocks = [];
				if (textOut.trim() !== "") assistantBlocks.push({ type: "text", text: textOut.trim() });
				for (const call of callList) assistantBlocks.push({ type: "tool-call", id: call.id, name: call.name, arguments: call.args });
				messages.push(createAssistantMessage({ content: assistantBlocks, source: { kind: "model", provider: selection.provider, model: selection.model } }));

				for (const call of callList) {
					let resultText = "";
					let isError = false;
					try {
						const value = await invokeTool(defs, call.name, call.args);
						const json = JSON.stringify(value, null, 2);
						resultText = json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}\n…（截断）` : json;
						actions.push({ tool: call.name, ok: true, summary: call.name });
					} catch (error) {
						isError = true;
						resultText = `工具执行失败：${String(error?.message ?? error)}`;
						actions.push({ tool: call.name, ok: false, summary: String(error?.message ?? error) });
					}
					messages.push(createToolResultMessage({ callId: call.id, content: textContent(resultText), isError }));
				}

				if (round === MAX_TOOL_ROUNDS) {
					return { reply: "工具调用轮次过多，已停止。请把问题拆小一点再试一次。", actions, provider: selection.provider, model: selection.model };
				}
			}
			return { reply: "没有生成回复。", actions, provider: selection.provider, model: selection.model };
		} finally {
			clearTimeout(timer);
		}
	}

	return { chat };
}
