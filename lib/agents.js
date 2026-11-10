/**
 * lib/agents.js — 工作台根目录、项目/任务目录、AGENTS.md 骨架与便携导出。
 *
 * v2 目录模型（用户要求）：
 *   <workbenchRoot>/<dirName>/                 ← 项目（目录由插件创建，不接受任意 rootPath）
 *     AGENTS.md                                ← 项目级指令骨架
 *     .dsh-project-workbench/board.json       ← 便携副本
 *     tasks/<taskId>/                         ← 任务目录（用任务唯一 ID，永不由用户指定）
 *       AGENTS.md                             ← 任务级增量指令（可选）
 *
 * 插件仍然**不读取也不注入** AGENTS.md——分层加载完全由
 * @deepseek-ai/dsh-agent-instructions 负责；这里只生成骨架、创建目录、
 * 计算“当前生效的指令层”并做便携导出。
 *
 * 工作台根目录可配置；变更时由 service 调用本模块的目录迁移原语自动搬迁。
 *
 * @module lib/agents
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** 项目内工作台便携目录名。 */
export const WORKBENCH_DIR = ".dsh-project-workbench";

/** 便携看板文件名。 */
export const BOARD_FILE = "board.json";

/** 便携 AGENTS.md 清单文件名。 */
export const MANIFEST_FILE = "AGENTS.md";

/** 任务目录一级目录名（项目根下）。 */
export const TASKS_DIR = "tasks";

/** 默认工作台根目录（可用 config.workbenchRoot 覆盖）。 */
export const DEFAULT_WORKBENCH_ROOT = "~/.dsh/workbench";

/**
 * 解析工作台根目录：展开 `~`，相对路径按 cwd 解析，必须是绝对路径。
 * @param {string} input
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveWorkbenchRoot(input, cwd = process.cwd()) {
	const text = typeof input === "string" ? input.trim() : "";
	const value = text === "" ? DEFAULT_WORKBENCH_ROOT : text;
	if (value === "~") return path.resolve(process.env.HOME ?? cwd);
	if (value.startsWith("~/")) return path.resolve(process.env.HOME ?? cwd, value.slice(2));
	return path.resolve(cwd, value);
}

/**
 * 名称 → 安全的单段目录名：保留 Unicode 字母/数字，其它折叠为 `-`。
 * @param {string} name
 * @param {number} [max]
 * @returns {string}
 */
export function slugifyName(name, max = 40) {
	const text = String(name ?? "")
		.normalize("NFKC")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max)
		.replace(/-+$/g, "");
	return text === "" ? "project" : text;
}

/**
 * 生成项目目录名：优先用户 folderName（仍做单段清洗），否则“名称-slug + ID 短后缀”。
 * @param {{ name: string, id: string, folderName?: string | null }} input
 * @returns {string}
 */
export function buildProjectDirName({ name, id, folderName = null }) {
	const requested = typeof folderName === "string" ? folderName.trim() : "";
	if (requested !== "") return slugifyName(requested, 60);
	const suffix = String(id ?? "").replace(/[^A-Za-z0-9]/g, "").slice(-8) || "project";
	return `${slugifyName(name, 40)}-${suffix}`;
}

/** 项目目录名（旧记录缺 dirName 时按名称 + ID 推导）。 */
export function projectDirName(project) {
	if (typeof project?.dirName === "string" && project.dirName.trim() !== "") return project.dirName;
	return buildProjectDirName({ name: project?.name ?? "project", id: project?.id ?? "project" });
}

/** 项目根目录。 */
export function projectRootPath(workbenchRoot, project) {
	return path.join(workbenchRoot, projectDirName(project));
}

/** 项目级 AGENTS.md 路径。 */
export function projectAgentsMdPath(rootPath) {
	return path.join(rootPath, "AGENTS.md");
}

/** 任务目录：`<projectRoot>/tasks/<taskId>`。 */
export function taskDirPath(rootPath, taskId) {
	return path.join(rootPath, TASKS_DIR, String(taskId));
}

/** 任务级 AGENTS.md 路径。 */
export function taskAgentsMdPath(rootPath, taskId) {
	return path.join(taskDirPath(rootPath, taskId), "AGENTS.md");
}

/** 子目标目录：`<taskDir>/goals/<goalId>`。 */
export function goalDirPath(rootPath, taskId, goalId) {
	return path.join(taskDirPath(rootPath, taskId), "goals", String(goalId));
}

/** 任务级产物目录：`<taskDir>/inputs` 或 `<taskDir>/outputs`。 */
export function taskArtifactsDir(rootPath, taskId, kind) {
	return path.join(taskDirPath(rootPath, taskId), kind === "output" ? "outputs" : "inputs");
}

/** 子目标产物目录：`<goalDir>/inputs` 或 `<goalDir>/outputs`。 */
export function goalArtifactsDir(rootPath, taskId, goalId, kind) {
	return path.join(goalDirPath(rootPath, taskId, goalId), kind === "output" ? "outputs" : "inputs");
}

/** 便携导出目录。 */
export function workbenchDir(rootPath) {
	return path.join(rootPath, WORKBENCH_DIR);
}

/** 便携看板路径。 */
export function boardFilePath(rootPath) {
	return path.join(workbenchDir(rootPath), BOARD_FILE);
}

/** 便携 AGENTS.md 清单路径。 */
export function manifestFilePath(rootPath) {
	return path.join(workbenchDir(rootPath), MANIFEST_FILE);
}

/** 旧版任务级 AGENTS.md 路径（v1 的 `.dsh-project-workbench/tasks/<id>/AGENTS.md`）。 */
export function legacyTaskAgentsMdPath(rootPath, taskId) {
	return path.join(workbenchDir(rootPath), TASKS_DIR, String(taskId), "AGENTS.md");
}

/**
 * 项目级 AGENTS.md 骨架：目标/背景 + 通用规则 + 工作台指引。
 * 用户可在创建项目时替换；生成后插件不再覆盖。
 * @param {{ id: string, name: string, description?: string, rootPath: string }} project
 * @returns {string}
 */
export function buildProjectAgentsTemplate(project) {
	const description = typeof project.description === "string" && project.description.trim() !== "" ? project.description.trim() : "（在这里补充项目目标、验收标准与背景。）";
	return [
		`# 项目：${project.name}`,
		"",
		"<!-- 由 dsh-project-workbench 生成；这是项目级 AGENTS.md，可自由编辑，插件不会覆盖已有内容。 -->",
		"",
		"## 目标 / 背景",
		"",
		description,
		"",
		"## 通用规则",
		"",
		"- 项目内所有任务共享本文件的背景、约束与验收口径；任务级 AGENTS.md 只写增量补充，不重复本节。",
		"- 开始工作前先确认任务状态与当前生效的指令层；完成后更新任务状态、评论与活动记录。",
		"- 需求不明确或存在阻塞时，在任务上留下未解决评论，让任务进入 needs-you 视图等待人工确认。",
		"",
		"## 工作台",
		"",
		`- 项目 ID：\`${project.id}\``,
		`- 项目根：\`${project.rootPath}\``,
		`- 任务目录：\`${TASKS_DIR}/<taskId>/\``,
		`- 看板便携副本：\`${path.join(WORKBENCH_DIR, BOARD_FILE)}\``,
		"",
	].join("\n");
}

/**
 * 任务级 AGENTS.md 骨架：只写增量，明确不重复项目级内容。
 * @param {{ id: string, title: string, description?: string }} task
 * @param {{ id: string, name: string }} project
 * @returns {string}
 */
export function buildTaskAgentsTemplate(task, project) {
	const description = typeof task.description === "string" && task.description.trim() !== "" ? task.description.trim() : "（在这里补充本任务的目标与验收标准。）";
	return [
		`# 任务：${task.title}`,
		"",
		"<!-- 由 dsh-project-workbench 生成；任务级增量指令。项目级通用规则在项目根 AGENTS.md，不要在这里重复。 -->",
		"",
		"## 任务目标",
		"",
		description,
		"",
		"## 局部规则（仅本任务）",
		"",
		"- （在这里补充仅本任务适用的约束、文件范围或验收步骤。）",
		"",
		"## 元数据",
		"",
		`- 任务 ID：\`${task.id}\``,
		`- 所属项目：${project.name}（\`${project.id}\`）`,
		"",
	].join("\n");
}

/**
 * 生成或确认项目级 AGENTS.md。
 * @param {{ rootPath: string, project: { id: string, name: string, description?: string }, content?: string | null }} options
 * @returns {Promise<{ path: string, existed: boolean, created: boolean, written: boolean }>}
 */
export async function ensureProjectAgentsMd({ rootPath, project, content = null }) {
	const target = projectAgentsMdPath(rootPath);
	await mkdir(rootPath, { recursive: true });
	const existed = existsSync(target);
	if (existed) return { path: target, existed: true, created: false, written: false };
	const body = typeof content === "string" && content.trim() !== "" ? content : buildProjectAgentsTemplate(project);
	await writeFileAtomic(target, `${body.replace(/\s+$/, "")}\n`);
	return { path: target, existed: false, created: true, written: true };
}

/**
 * 确保任务目录存在（任务目录名 = 任务唯一 ID）。
 * @param {{ rootPath: string, taskId: string }} options
 * @returns {Promise<string>} 任务目录绝对路径
 */
export async function ensureTaskDir({ rootPath, taskId }) {
	const target = taskDirPath(rootPath, taskId);
	await mkdir(target, { recursive: true });
	return target;
}

/**
 * 写任务级 AGENTS.md（仅当调用方明确需要局部指令时）。
 * 已存在时不覆盖，避免冲掉用户/agent 的编辑。
 * @param {{ rootPath: string, project: { id: string, name: string }, task: { id: string, title: string, description?: string }, content?: string | null }} options
 * @returns {Promise<{ path: string, existed: boolean, created: boolean, written: boolean }>}
 */
export async function writeTaskAgentsMd({ rootPath, project, task, content = null }) {
	const dir = await ensureTaskDir({ rootPath, taskId: task.id });
	const target = path.join(dir, "AGENTS.md");
	const existed = existsSync(target);
	if (existed) return { path: target, existed: true, created: false, written: false };
	const body = typeof content === "string" && content.trim() !== "" ? content : buildTaskAgentsTemplate(task, project);
	await writeFileAtomic(target, `${body.replace(/\s+$/, "")}\n`);
	return { path: target, existed: false, created: true, written: true };
}

/**
 * 计算“当前生效的指令层”。只展示，不加载——加载由 dsh-agent-instructions 完成。
 * @param {{ rootPath: string, taskId?: string | null }} options
 * @returns {Promise<{ loader: string, project: { level: 'project', path: string, exists: boolean }, task: ({ level: 'task', path: string, exists: boolean } | null), taskDir: string | null, effectiveLayers: Array<{ level: string, path: string }>, expected: { taskPath: string | null }, note: string }>}
 */
export async function instructionsFor({ rootPath, taskId = null }) {
	const projectPath = projectAgentsMdPath(rootPath);
	const projectExists = await pathExists(projectPath);
	const taskPath = taskId === null || taskId === undefined ? null : taskAgentsMdPath(rootPath, taskId);
	const taskDir = taskId === null || taskId === undefined ? null : taskDirPath(rootPath, taskId);
	const taskExists = taskPath === null ? false : await pathExists(taskPath);
	const effectiveLayers = [];
	if (projectExists) effectiveLayers.push({ level: "project", path: projectPath });
	if (taskExists) effectiveLayers.push({ level: "task", path: taskPath });
	return {
		loader: "@deepseek-ai/dsh-agent-instructions",
		project: { level: "project", path: projectPath, exists: projectExists },
		task: taskExists ? { level: "task", path: taskPath, exists: true } : null,
		taskDir,
		effectiveLayers,
		expected: { taskPath },
		note:
			"插件只生成骨架并展示继承关系，不接管 AGENTS.md 的读取与注入。实际加载由 dsh-agent-instructions 按“项目根 → 会话工作目录”逐层完成：" +
			"项目级 AGENTS.md 在会话工作目录位于项目根之下时生效；任务级 AGENTS.md 只有在会话工作目录进入该任务目录（tasks/<taskId>）时才会被加载。",
	};
}

/** 路径是否存在（文件或目录）。 */
export async function pathExists(target) {
	try {
		await stat(target);
		return true;
	} catch {
		return false;
	}
}

/** 是否为目录。 */
export async function isDirectory(target) {
	try {
		return (await stat(target)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * 原子写入：同目录临时文件 + rename。
 * @param {string} target
 * @param {string} content
 */
export async function writeFileAtomic(target, content) {
	await mkdir(path.dirname(target), { recursive: true });
	const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await writeFile(tmp, content, "utf8");
	await rename(tmp, target);
}

/**
 * 搬迁目录：优先 rename；跨设备/权限不允许时退化为递归复制 + 删除源。
 * @param {string} source
 * @param {string} destination
 * @returns {Promise<'renamed' | 'copied'>}
 */
export async function moveDirectory(source, destination) {
	await mkdir(path.dirname(destination), { recursive: true });
	try {
		await rename(source, destination);
		return "renamed";
	} catch (error) {
		if (error?.code !== "EXDEV" && error?.code !== "EPERM" && error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") throw error;
	}
	await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
	await rm(source, { recursive: true, force: true });
	return "copied";
}

/**
 * 复制目录（不删除源；用于从历史外部 rootPath 收养目录，避免数据丢失）。
 * @param {string} source
 * @param {string} destination
 */
export async function copyDirectory(source, destination) {
	await mkdir(path.dirname(destination), { recursive: true });
	await cp(source, destination, { recursive: true, force: true, errorOnExist: false });
}

/**
 * 便携导出队列：同一项目根串行写，失败只记录日志，不影响主存储。
 * @type {Map<string, Promise<unknown>>}
 */
const exportChains = new Map();

/**
 * 导出人类可读的 board.json + AGENTS.md 清单（辅助副本，不是主存储）。
 * @param {{ rootPath: string, workbenchRoot?: string, project: object, tasks: object[], stats: object, instructions: object, logger?: { warn?: Function }, now?: () => string }} options
 * @returns {Promise<{ ok: boolean, dir: string, boardPath: string, manifestPath: string, error?: string }>}
 */
export async function exportPortableCopy({ rootPath, workbenchRoot = "", project, tasks, stats, instructions, logger, now = () => new Date().toISOString() }) {
	const key = rootPath;
	const previous = exportChains.get(key) ?? Promise.resolve();
	const run = previous.catch(() => undefined).then(async () => {
		const dir = workbenchDir(rootPath);
		await mkdir(dir, { recursive: true });
		const exportedAt = now();
		const board = {
			format: "dsh-project-workbench/board",
			version: 2,
			exportedAt,
			workbenchRoot,
			project: {
				id: project.id,
				name: project.name,
				description: project.description ?? "",
				dirName: project.dirName ?? "",
				rootPath: project.rootPath,
				status: project.status,
				createdAt: project.createdAt,
			},
			stats,
			instructions: {
				loader: instructions.loader,
				project: instructions.project,
				task: instructions.task,
			},
			tasks: tasks.map((task) => ({ ...task })),
		};
		await writeFileAtomic(boardFilePath(rootPath), `${JSON.stringify(board, null, 2)}\n`);
		await writeFileAtomic(manifestFilePath(rootPath), buildManifest({ workbenchRoot, project, tasks, stats, instructions, exportedAt }));
		return { ok: true, dir, boardPath: boardFilePath(rootPath), manifestPath: manifestFilePath(rootPath) };
	});
	exportChains.set(key, run);
	try {
		return await run;
	} catch (error) {
		logger?.warn?.(`[project-workbench] portable export failed for ${rootPath}: ${String(error?.stack ?? error)}`);
		return { ok: false, dir: workbenchDir(rootPath), boardPath: boardFilePath(rootPath), manifestPath: manifestFilePath(rootPath), error: String(error?.message ?? error) };
	} finally {
		if (exportChains.get(key) === run) exportChains.delete(key);
	}
}

/**
 * 便携 AGENTS.md 清单正文。
 * @param {{ workbenchRoot?: string, project: object, tasks: object[], stats: object, instructions: object, exportedAt: string }} input
 * @returns {string}
 */
export function buildManifest({ workbenchRoot = "", project, tasks, stats, instructions, exportedAt }) {
	const lines = [
		`# 工作台导出：${project.name}`,
		"",
		"> 本目录是 dsh-project-workbench 的便携副本，可提交到 git。主数据存储在 DSH storageDomain；",
		"> 本文件由插件自动生成，请勿手工编辑。项目级指令请编辑仓库根目录的 AGENTS.md。",
		"",
		`- 项目 ID：\`${project.id}\``,
		`- 工作台根：\`${workbenchRoot}\``,
		`- 项目目录：\`${project.dirName ?? ""}\``,
		`- 项目根：\`${project.rootPath}\``,
		`- 状态：${project.status}`,
		`- 导出时间：${exportedAt}`,
		`- 统计：backlog ${stats.backlog} / running ${stats.running} / needs-you ${stats.needsYou} / done ${stats.done}`,
		"",
		"## 指令层（由 dsh-agent-instructions 加载，插件只生成骨架）",
		"",
		`- 项目级：\`${instructions.project.path}\`（${instructions.project.exists ? "存在" : "缺失"}）`,
	];
	const taskLayer = instructions.task;
	if (taskLayer !== null && taskLayer !== undefined) {
		lines.push(`- 任务级：\`${taskLayer.path}\`（存在）`);
	} else {
		lines.push("- 任务级：当前任务没有任务级 AGENTS.md");
	}
	lines.push("", "## 任务", "");
	if (tasks.length === 0) {
		lines.push("（暂无任务）");
	} else {
		for (const task of tasks) {
			const viewStatus = task.viewStatus ?? task.status;
			const due = task.dueAt === null ? "" : `，截止 ${task.dueAt}`;
			const dir = task.taskDir ?? taskDirPath(project.rootPath, task.id);
			lines.push(`- [${task.status === "done" ? "x" : " "}] ${task.title}（${viewStatus}，${task.priority}${due}）\`${task.id}\` → \`${dir}\``);
		}
	}
	return `${lines.join("\n")}\n`;
}
