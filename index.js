/**
 * index.js — dsh-project-workbench host 入口（cordis 插件）。
 *
 * 形态：Cordis 插件 bundle（package.json + cordis.patch.yml + host/client 入口）。
 * host 侧负责：
 *   - 用 ctx.storageDomain 打开 project/task 两个 domain（主存储）；
 *   - 7 个 workbench_* 智能体工具（@deepseek-ai/dsh-tools defineTool）；
 *   - 同源 HTTP 路由 /workbench-api/*（给 Web client 读，也承担看板拖拽写入）；
 *   - 项目/任务级 AGENTS.md 骨架生成与便携导出（辅助，不接管指令加载）。
 *
 * 所有注册都经 ctx.effect / ctx.inject 管理，卸载时能干净释放：
 * domain 句柄、HTTP 路由、工具注册都会在 disposer 里关闭。
 *
 * @module index
 */

import { registerWorkbenchRoutes } from "./lib/api.js";
import { createAssistantService } from "./lib/assistant.js";
import { ActivityIndex } from "./lib/activity-index.js";
import { openWorkbenchDomains, WorkbenchStore } from "./lib/domain.js";
import { WorkbenchService } from "./lib/service.js";
import { registerWorkbenchTools } from "./lib/tools.js";

/** 插件名（与 cordis.patch.yml 的 id 对齐）。 */
const name = "project-workbench";

/** webServer 与 storageDomain 在 web profile 里由 base/web-app 提供。 */
const inject = ["webServer", "storageDomain"];

/**
 * 配置归一化。
 * - `defaultProjectRootMarker`：缺省 `[""]`，表示“用当前 cwd 作为项目根”；
 * - `projectRootMarkers`：缺省 `[".git"]`，只用于确认 rootPath 是否项目根；
 *   找不到时按“项目路径即根”退化（不向上改写）。
 * - `enableBoardView`：缺省 true（client 仍保留列表视图）。
 * - `exportPortableFiles`：缺省 true，导出 .dsh-project-workbench/board.json + AGENTS.md 清单。
 * @param {object} raw
 */
export function normalizeConfig(raw = {}) {
	const value = raw !== null && typeof raw === "object" ? raw : {};
	const workbenchRoot = typeof value.workbenchRoot === "string" ? value.workbenchRoot.trim() : "";
	return {
		// 缺省 ~/.dsh/workbench；显式配置后启动时会把旧根目录自动迁移到新值。
		workbenchRoot: workbenchRoot === "" ? "~/.dsh/workbench" : workbenchRoot,
		workbenchRootExplicit: workbenchRoot !== "",
		enableBoardView: value.enableBoardView !== false,
		exportPortableFiles: value.exportPortableFiles !== false,
	};
}

/**
 * 挂载插件。
 * @param {any} ctx cordis 上下文
 * @param {object} [config] 插件配置
 */
async function apply(ctx, config = {}) {
	const cfg = normalizeConfig(config);
	// 不用 ctx.cwd：它是需要声明 inject 的服务；这里取宿主进程的工作目录，
	// 与“默认 rootPath = 当前 cwd”的产品口径一致。
	const cwd = process.cwd();
	const store = new WorkbenchStore({
		open: () => openWorkbenchDomains(ctx.storageDomain),
	});
	const service = new WorkbenchService({ store, config: cfg, logger: ctx.logger, cwd });
	const llmRefs = { llm: null, defaultModel: null };
	const speechRef = { controller: null, service: null };
	const assistant = createAssistantService({
		service,
		getLlm: () => llmRefs.llm,
		getDefaultModel: () => llmRefs.defaultModel,
		logger: ctx.logger,
	});
	const activityIndex = new ActivityIndex({
		getIndexPath: () => service.getActivityIndexPath(),
		logger: ctx.logger,
	});
	service.setActivityIndex(activityIndex);
	activityIndex.start(ctx).catch((error) => {
		ctx.logger?.warn?.(`[project-workbench] activity index start failed: ${String(error?.stack ?? error)}`);
	});
	ctx.effect(() => () => activityIndex.dispose(), "project-workbench: activity index");

	// 主存储惰性打开：storageDomain 缺失/打开失败时插件仍能挂载，
	// HTTP / 工具会返回可读的 storage-unavailable 错误，而不是让整个 profile 起不来。
	// 首次读写会确保工作台根目录存在，并按配置/历史值自动迁移旧目录。
	service.getSettings().then(
		(settings) => ctx.logger?.info?.(`[project-workbench] workbench root ready: ${settings.workbenchRoot} (projects ${settings.projectCount}, tasks ${settings.taskCount})`),
		(error) => ctx.logger?.error?.(`[project-workbench] workbench root unavailable: ${String(error?.stack ?? error)}`),
	);

	ctx.effect(() => () => {
		void store.close();
	}, "project-workbench: storage domains");

	ctx.effect(() => registerWorkbenchRoutes(ctx, service, {
		assistant,
		getSpeechController: () => speechRef.controller,
		getSpeechToText: () => speechRef.service,
	}), "project-workbench: api routes");

	// 工作台根目录默认就是一个 DSH 工作区：启动时确保注册，供 AI 助手/会话复用。
	ctx.inject(["workspaceRegistry"], (child) => {
		child.effect(() => {
			let disposed = false;
			service.getSettings().then(async (settings) => {
				if (disposed) return;
				try {
					await child.workspaceRegistry.create(settings.workbenchRoot, "工作台");
				} catch (error) {
					ctx.logger?.warn?.(`[project-workbench] ensure default workspace failed: ${String(error?.stack ?? error)}`);
				}
			});
			return () => {
				disposed = true;
			};
		}, "project-workbench: default workspace");
	});

	ctx.inject(["llm"], (child) => {
		child.effect(() => {
			llmRefs.llm = child.llm;
			return () => {
				llmRefs.llm = null;
			};
		}, "project-workbench: llm");
	});

	ctx.inject(["speechController"], (child) => {
		child.effect(() => {
			speechRef.controller = child.speechController;
			return () => {
				speechRef.controller = null;
			};
		}, "project-workbench: speech");
	});

	ctx.inject(["speechToText"], (child) => {
		child.effect(() => {
			speechRef.service = child.speechToText;
			return () => {
				speechRef.service = null;
			};
		}, "project-workbench: speech-to-text");
	});

	ctx.inject(["agentDefaultModel"], (child) => {
		child.effect(() => {
			llmRefs.defaultModel = child.agentDefaultModel;
			return () => {
				llmRefs.defaultModel = null;
			};
		}, "project-workbench: default model");
	});

	// tools 是可选能力：tools 服务缺失时插件照常挂载，只是没有 agent 工具。
	ctx.inject(["tools"], (child) => {
		child.effect(() => registerWorkbenchTools(child, service), "project-workbench: agent tools");
		ctx.logger?.info?.("[project-workbench] agent tools mounted");
	});
}

export { apply, inject, name };
