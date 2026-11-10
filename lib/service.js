/**
 * lib/service.js — 工作台业务核心（项目 → 任务 + needs-you 派生 + 文件骨架/导出）。
 *
 * 所有主读写都通过 WorkbenchStore → ctx.storageDomain；文件只做骨架生成与
 * 便携导出，且失败不会回滚主存储（最多带回 warnings）。
 *
 * 关键产品约束：
 *   - 一个 Task 只属于一个 Project（projectId 单值）；
 *   - needs-you 不是存储状态：blocked / waitingReview / 未解决评论任一成立即派生；
 *   - Project 归档后只读，可恢复；非空项目不可删除。
 *
 * @module lib/service
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { fail } from "./errors.js";
import { getLastInteractionAt } from "./session-interaction.js";
import {
	DEFAULT_WORKBENCH_ROOT,
	buildProjectDirName,
	copyDirectory,
	ensureProjectAgentsMd,
	ensureTaskDir,
	exportPortableCopy,
	goalArtifactsDir,
	goalDirPath,
	taskArtifactsDir,
	instructionsFor,
	isDirectory,
	legacyTaskAgentsMdPath,
	moveDirectory,
	pathExists,
	projectDirName,
	resolveWorkbenchRoot,
	taskAgentsMdPath,
	taskDirPath,
	writeTaskAgentsMd,
} from "./agents.js";

/** 任务状态机（底层）。 */
export const TASK_STATUSES = Object.freeze(["backlog", "running", "done"]);

/** 看板列（needs-you 为派生列）。 */
export const BOARD_COLUMNS = Object.freeze(["backlog", "running", "needs-you", "done"]);

/** 优先级。 */
export const TASK_PRIORITIES = Object.freeze(["low", "medium", "high", "urgent"]);

/** 优先级排序权重。 */
const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, medium: 2, low: 3 });

/** 状态排序权重。 */
const STATUS_RANK = Object.freeze({ "needs-you": 0, running: 1, backlog: 2, done: 3 });

/** 单个文本字段上限（防止把整个文件塞进评论/描述）。 */
const MAX_TEXT = 20000;

/** 递归建目录（`fs.mkdir` 的薄封装，避免顶层再引入一次 fs）。 */
async function mkdirRecursive(dir) {
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dir, { recursive: true });
}

/** 路径是否相同（解析后比较）。 */
function isSamePath(a, b) {
	return path.resolve(a) === path.resolve(b);
}

/** child 是否位于 parent 之下（不含 parent 自身）。 */
function isInside(child, parent) {
	const relative = path.relative(path.resolve(parent), path.resolve(child));
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** 统计未解决评论数量。 */
export function unresolvedCommentCount(task) {
	if (!Array.isArray(task?.comments)) return 0;
	let count = 0;
	for (const comment of task.comments) if (comment?.resolved !== true) count += 1;
	return count;
}

/** needs-you 派生判断：未解决评论 / 阻塞 / 等待审核，任一成立。 */
export function isNeedsYou(task) {
	if (task === null || task === undefined) return false;
	if (task.blocked === true || task.waitingReview === true) return true;
	return unresolvedCommentCount(task) > 0;
}

/** 派生视图状态：needs-you 覆盖底层 workflow 状态。 */
export function viewStatusOf(task) {
	return isNeedsYou(task) ? "needs-you" : task.status;
}

/** needs-you 的具体原因（给 UI / 工具展示，不只给一个布尔）。 */
export function needsYouReasons(task) {
	const reasons = [];
	const unresolved = unresolvedCommentCount(task);
	if (unresolved > 0) reasons.push({ code: "unresolved-comments", count: unresolved, label: `${unresolved} 条未解决评论` });
	if (task.blocked === true) reasons.push({ code: "blocked", label: "已标记阻塞" });
	if (task.waitingReview === true) reasons.push({ code: "waiting-review", label: "等待审核" });
	return reasons;
}

/**
 * 任务统计（按派生视图计数，另附底层状态计数与质量指标）。
 * @param {object[]} tasks
 * @param {string} [nowIso]
 */
export function statsOf(tasks, nowIso = new Date().toISOString()) {
	const now = Date.parse(nowIso);
	const stats = {
		total: 0,
		backlog: 0,
		running: 0,
		needsYou: 0,
		done: 0,
		stored: { backlog: 0, running: 0, done: 0 },
		blocked: 0,
		waitingReview: 0,
		unresolvedComments: 0,
		overdue: 0,
	};
	for (const task of tasks) {
		if (task === null || task === undefined) continue;
		stats.total += 1;
		const view = viewStatusOf(task);
		if (view === "needs-you") stats.needsYou += 1;
		else if (view === "backlog") stats.backlog += 1;
		else if (view === "running") stats.running += 1;
		else if (view === "done") stats.done += 1;
		if (task.status === "backlog" || task.status === "running" || task.status === "done") stats.stored[task.status] += 1;
		if (task.blocked === true) stats.blocked += 1;
		if (task.waitingReview === true) stats.waitingReview += 1;
		stats.unresolvedComments += unresolvedCommentCount(task);
		if (typeof task.dueAt === "string" && task.status !== "done") {
			const due = Date.parse(task.dueAt);
			if (Number.isFinite(due) && Number.isFinite(now) && due < now) stats.overdue += 1;
		}
	}
	return stats;
}

/** 任务摘要（列表 / 看板卡）。 */
export function summarizeTask(task, { childCount = 0 } = {}) {
	const unresolved = unresolvedCommentCount(task);
	return {
		id: task.id,
		projectId: task.projectId,
		parentId: task.parentId ?? null,
		title: task.title,
		description: task.description ?? "",
		goal: task.goal ?? "",
		status: task.status,
		viewStatus: viewStatusOf(task),
		priority: task.priority,
		dueAt: task.dueAt ?? null,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		completedAt: task.completedAt ?? null,
		sessionId: task.sessionId ?? null,
		sessionTitle: task.sessionTitle ?? "",
		artifactCount: Array.isArray(task.artifacts) ? task.artifacts.length : 0,
		inputCount: Array.isArray(task.artifacts) ? task.artifacts.filter((artifact) => artifact.kind === "input").length : 0,
		outputCount: Array.isArray(task.artifacts) ? task.artifacts.filter((artifact) => artifact.kind === "output").length : 0,
		blocked: task.blocked === true,
		waitingReview: task.waitingReview === true,
		commentCount: Array.isArray(task.comments) ? task.comments.length : 0,
		unresolvedCommentCount: unresolved,
		childCount,
		needsYou: isNeedsYou(task),
		needsYouReasons: needsYouReasons(task),
	};
}

/** 项目摘要。 */
export function summarizeProject(project, stats, extra = {}) {
	return {
		id: project.id,
		name: project.name,
		description: project.description ?? "",
		dirName: project.dirName ?? projectDirName(project),
		rootPath: project.rootPath,
		status: project.status,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		archivedAt: project.archivedAt ?? null,
		stats,
		...extra,
	};
}

/** 生成带前缀的短 id。 */
function newId(prefix) {
	return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

/** 文本规整：trim、上限、类型检查。 */
function cleanText(value, field, { required = false, max = MAX_TEXT } = {}) {
	if (value === undefined || value === null) {
		if (required) throw fail("invalid-input", `${field} 不能为空`);
		return "";
	}
	if (typeof value !== "string") throw fail("invalid-input", `${field} 必须是字符串`);
	const text = value.trim();
	if (required && text === "") throw fail("invalid-input", `${field} 不能为空`);
	if (text.length > max) throw fail("invalid-input", `${field} 过长（上限 ${max} 字符）`);
	return text;
}

/** 解析截止时间：null / 空串 → null；其余必须是可解析日期。 */
function parseDueAt(value) {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "string") throw fail("invalid-due", "dueAt 必须是 ISO 时间字符串或 null");
	const text = value.trim();
	if (text === "") return null;
	const time = Date.parse(text);
	if (!Number.isFinite(time)) throw fail("invalid-due", `无法解析截止时间：${text}`);
	return new Date(time).toISOString();
}

/** 解析并校验优先级。 */
function parsePriority(value, field = "priority") {
	if (value === undefined) return undefined;
	const text = typeof value === "string" ? value.trim() : "";
	if (!TASK_PRIORITIES.includes(text)) throw fail("invalid-priority", `priority 必须是 ${TASK_PRIORITIES.join(" / ")}`);
	return text;
}

/** 解析子目标状态。 */
function parseGoalStatus(value) {
	const text = typeof value === "string" ? value.trim() : "";
	if (!["open", "doing", "done"].includes(text)) throw fail("invalid-status", "子目标 status 必须是 open / doing / done");
	return text;
}

/** 解析产物类型。 */
function parseArtifactKind(value) {
	const text = typeof value === "string" ? value.trim() : "";
	if (text !== "input" && text !== "output") throw fail("invalid-input", "产物 kind 必须是 input / output");
	return text;
}

/** 文件名清洗：只保留单段安全字符。 */
function safeFileName(name, fallback = "artifact") {
	const base = path.basename(String(name ?? "").trim());
	const cleaned = base
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}._-]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 160);
	return cleaned === "" ? fallback : cleaned;
}

/** 按扩展名猜 MIME（足够下载展示用）。 */
function guessMime(name) {
	const ext = path.extname(String(name ?? "")).toLowerCase();
	const table = {
		".md": "text/markdown; charset=utf-8",
		".txt": "text/plain; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".csv": "text/csv; charset=utf-8",
		".html": "text/html; charset=utf-8",
		".pdf": "application/pdf",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".svg": "image/svg+xml",
		".zip": "application/zip",
	};
	return table[ext] ?? "application/octet-stream";
}

/** 解析并校验底层任务状态（拒绝 needs-you）。 */
function parseTaskStatus(value) {
	const text = typeof value === "string" ? value.trim() : "";
	if (text === "needs-you") throw fail("needs-you-derived", "needs-you 是派生视图，不是可写入的状态；请改用评论/阻塞/等待审核标记");
	if (!TASK_STATUSES.includes(text)) throw fail("invalid-status", `status 必须是 ${TASK_STATUSES.join(" / ")}`);
	return text;
}

/** 任务排序：needs-you → running → backlog → done，再按优先级、截止时间、创建时间。 */
export function compareTasks(a, b) {
	const sa = STATUS_RANK[viewStatusOf(a)] ?? 9;
	const sb = STATUS_RANK[viewStatusOf(b)] ?? 9;
	if (sa !== sb) return sa - sb;
	const pa = PRIORITY_RANK[a.priority] ?? 9;
	const pb = PRIORITY_RANK[b.priority] ?? 9;
	if (pa !== pb) return pa - pb;
	const da = typeof a.dueAt === "string" ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
	const db = typeof b.dueAt === "string" ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
	if (da !== db) return da - db;
	return String(a.createdAt).localeCompare(String(b.createdAt));
}

/** 本地日期是否是同一天。 */
function sameLocalDay(left, right) {
	const a = new Date(left);
	const b = new Date(right);
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 本地周一 00:00 的时间戳。 */
function startOfLocalWeek(timeMs) {
	const date = new Date(timeMs);
	date.setHours(0, 0, 0, 0);
	const offset = (date.getDay() + 6) % 7;
	date.setDate(date.getDate() - offset);
	return date.getTime();
}

/** 任务是否逾期（未完成且截止时间已过）。 */
function isOverdueTask(task, nowMs) {
	if (task.status === "done" || typeof task.dueAt !== "string" || task.dueAt === "") return false;
	const due = Date.parse(task.dueAt);
	return Number.isFinite(due) && due < nowMs;
}

/** 工作台业务服务。 */
export class WorkbenchService {
	/**
	 * @param {{
	 *   store: { projects: () => Promise<any>, tasks: () => Promise<any> },
	 *   config?: object,
	 *   logger?: { info?: Function, warn?: Function, error?: Function },
	 *   cwd?: string,
	 *   now?: () => string,
	 * }} options
	 */
	constructor({ store, config = {}, logger = null, cwd = process.cwd(), now = () => new Date().toISOString() }) {
		this.store = store;
		this.logger = logger;
		this.cwd = cwd;
		this._now = now;
		this.config = {
			workbenchRoot: resolveWorkbenchRoot(config.workbenchRoot, cwd),
			workbenchRootExplicit: config.workbenchRootExplicit === true,
			enableBoardView: config.enableBoardView !== false,
			exportPortableFiles: config.exportPortableFiles !== false,
		};
		this._workbenchRoot = null;
		this._rootReady = null;
	}

	now() {
		return this._now();
	}

	/* ───────────────────────── 内部读写 ───────────────────────── */

	async _projects() {
		return await this.store.projects();
	}

	async _tasks() {
		return await this.store.tasks();
	}

	async _tasksOf(projectId) {
		const table = await this._tasks();
		const found = [];
		for (const [, task] of table.entries()) {
			if (task.projectId === projectId) found.push(task);
		}
		return found;
	}

	async _allTasks() {
		const table = await this._tasks();
		return [...table.entries()].map(([, task]) => task);
	}

	async _allProjects() {
		const table = await this._projects();
		return [...table.entries()].map(([, project]) => project);
	}

	/** 工作台根目录（确保初始化/迁移完成）。 */
	async _ensureRoot() {
		if (this._rootReady === null) {
			this._rootReady = this._doEnsureRoot().catch((error) => {
				this._rootReady = null;
				throw error;
			});
		}
		return await this._rootReady;
	}

	async _doEnsureRoot() {
		const settings = await this.store.settings();
		const stored = settings.get();
		const desired = this.config.workbenchRootExplicit || typeof stored.rootPath !== "string" || stored.rootPath === ""
			? resolveWorkbenchRoot(this.config.workbenchRoot, this.cwd)
			: stored.rootPath;
		const existingProjects = await this._allProjects();
		if (stored.rootPath !== desired && (stored.rootPath !== "" || existingProjects.length > 0)) {
			await this._migrateTo(desired, stored.rootPath);
		}
		await mkdirRecursive(desired);
		await settings.set({ rootPath: desired, source: this.config.workbenchRootExplicit ? "config" : stored.source === "user" ? "user" : "config" });
		this._workbenchRoot = desired;
		for (const project of await this._allProjects()) await this._ensureProjectLayout(project);
		return desired;
	}

	async _ensureProjectLayout(project) {
		await mkdirRecursive(project.rootPath);
		try {
			await ensureProjectAgentsMd({ rootPath: project.rootPath, project });
		} catch (error) {
			this.logger?.warn?.(`[project-workbench] ensure project AGENTS.md failed: ${String(error?.stack ?? error)}`);
		}
		const tasks = await this._tasksOf(project.id);
		for (const task of tasks) {
			await ensureTaskDir({ rootPath: project.rootPath, taskId: task.id });
			const legacy = legacyTaskAgentsMdPath(project.rootPath, task.id);
			const current = taskAgentsMdPath(project.rootPath, task.id);
			if (!(await pathExists(current)) && (await pathExists(legacy))) {
				try {
					const { copyFile } = await import("node:fs/promises");
					await copyFile(legacy, current);
				} catch (error) {
					this.logger?.warn?.(`[project-workbench] legacy task AGENTS.md copy failed: ${String(error?.stack ?? error)}`);
				}
			}
		}
		const warnings = [];
		await this._export(project, warnings);
		return warnings;
	}

	/**
	 * 把项目目录搬迁到新的工作台根目录。
	 * - 旧目录在旧根/新根之内：move（数据只保留一份）；
	 * - 旧目录在历史外部路径（v1 自由 rootPath）：copy 到新根，保留原目录，避免误删。
	 */
	async _migrateTo(desiredRoot, oldRoot) {
		if (oldRoot !== "" && (isSamePath(desiredRoot, oldRoot) || isInside(desiredRoot, oldRoot) || isInside(oldRoot, desiredRoot))) {
			throw fail("root-migration-failed", `工作台根目录不能与旧根相同或互相嵌套：${oldRoot} → ${desiredRoot}`);
		}
		await mkdirRecursive(desiredRoot);
		this._workbenchRoot = desiredRoot;
		const table = await this._projects();
		for (const project of await this._allProjects()) {
			const dirName = projectDirName(project);
			const target = path.join(desiredRoot, dirName);
			const source = project.rootPath;
			if (!isSamePath(source, target)) {
				const sourceExists = await isDirectory(source);
				const targetExists = await pathExists(target);
				if (sourceExists && !targetExists) {
					const managed = oldRoot !== "" && (isInside(source, oldRoot) || isSamePath(source, oldRoot));
					try {
						if (managed) await moveDirectory(source, target);
						else await copyDirectory(source, target);
					} catch (error) {
						throw fail("root-migration-failed", `迁移项目目录失败：${source} → ${target}（${String(error?.message ?? error)}）`);
					}
				} else if (sourceExists && targetExists && !isSamePath(source, target)) {
					this.logger?.warn?.(`[project-workbench] migration target already exists, keeping both: ${source} / ${target}`);
				}
				await table.update(project.id, (current) => ({ ...current, dirName, rootPath: target, updatedAt: this.now() }));
			} else if (project.dirName !== dirName) {
				await table.update(project.id, (current) => ({ ...current, dirName, updatedAt: this.now() }));
			}
			await this._ensureProjectLayout({ ...project, dirName, rootPath: target });
		}
		this._workbenchRoot = desiredRoot;
	}

	async _uniqueDirName(base) {
		const taken = new Set((await this._allProjects()).map((project) => projectDirName(project)));
		let candidate = base;
		let suffix = 2;
		while (taken.has(candidate) || (await pathExists(path.join(this._workbenchRoot, candidate)))) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		return candidate;
	}

	async _projectOrThrow(projectId) {
		const id = typeof projectId === "string" ? projectId.trim() : "";
		if (id === "") throw fail("invalid-id", "projectId 不能为空");
		const project = (await this._projects()).get(id);
		if (project === undefined) throw fail("not-found", `项目不存在：${id}`);
		return project;
	}

	async _taskOrThrow(taskId) {
		const id = typeof taskId === "string" ? taskId.trim() : "";
		if (id === "") throw fail("invalid-id", "taskId 不能为空");
		const task = (await this._tasks()).get(id);
		if (task === undefined) throw fail("not-found", `任务不存在：${id}`);
		return task;
	}

	_assertActive(project) {
		if (project.status === "archived") throw fail("project-archived", `项目「${project.name}」已归档，只读；请先恢复项目`);
	}

	/* ───────────────────────── 项目 ───────────────────────── */

	/**
	 * 列出项目（默认只看 active）。
	 * @param {{ status?: 'active'|'archived'|'all' }} [options]
	 */
	async listProjects({ status = "active" } = {}) {
		await this._ensureRoot();
		const table = await this._projects();
		const filter = status === "all" ? null : status;
		if (filter !== null && filter !== "active" && filter !== "archived") throw fail("invalid-status", "status 必须是 active / archived / all");
		const projects = [];
		const allTasks = await this._allTasks();
		const tasksByProject = new Map();
		for (const task of allTasks) {
			if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, []);
			tasksByProject.get(task.projectId).push(task);
		}
		for (const [, project] of table.entries()) {
			if (filter !== null && project.status !== filter) continue;
			const tasks = tasksByProject.get(project.id) ?? [];
			projects.push(summarizeProject(project, statsOf(tasks, this.now()), { agentsMdPath: path.join(project.rootPath, "AGENTS.md") }));
		}
		projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
		return { total: projects.length, workbenchRoot: this._workbenchRoot, projects };
	}

	/**
	 * 项目详情 + 任务列表（可筛选派生状态）。
	 * @param {string} projectId
	 * @param {{ taskStatus?: string }} [options]
	 */
	async getProject(projectId, { taskStatus = "all" } = {}) {
		await this._ensureRoot();
		const project = await this._projectOrThrow(projectId);
		const tasks = await this._tasksOf(project.id);
		const childrenByParent = this._childrenCounts(tasks);
		const filtered = this._filterTasks(tasks, taskStatus);
		const instructions = await instructionsFor({ rootPath: project.rootPath, taskId: null });
		return {
			project: summarizeProject(project, statsOf(tasks, this.now()), {
				agentsMdPath: path.join(project.rootPath, "AGENTS.md"),
				workbenchRoot: this._workbenchRoot,
			}),
			workbenchRoot: this._workbenchRoot,
			tasks: filtered.map((task) => summarizeTask(task, { childCount: childrenByParent.get(task.id) ?? 0 })),
			filteredTotal: filtered.length,
			stats: statsOf(tasks, this.now()),
			instructions,
			enableBoardView: this.config.enableBoardView,
		};
	}

	/**
	 * 创建项目：目录自动建在工作台根下（不接受任意 rootPath）。
	 * `folderName` 可选，仍然只是工作台根下的一级目录名；缺省用“名称-slug + ID 后缀”。
	 * @param {{ name: string, description?: string, folderName?: string, agentsMd?: string, actor?: string }} input
	 */
	async createProject(input = {}) {
		await this._ensureRoot();
		const name = cleanText(input.name, "name", { required: true, max: 300 });
		const description = cleanText(input.description, "description");
		const folderName = cleanText(input.folderName, "folderName", { max: 60 });
		const actor = input.actor === "agent" ? "agent" : "user";
		const id = newId("p");
		const dirName = await this._uniqueDirName(buildProjectDirName({ name, id, folderName: folderName === "" ? null : folderName }));
		const rootPath = path.join(this._workbenchRoot, dirName);
		await mkdirRecursive(rootPath);
		const timestamp = this.now();
		const project = {
			id,
			name,
			description,
			dirName,
			rootPath,
			status: "active",
			createdAt: timestamp,
			updatedAt: timestamp,
			archivedAt: null,
		};
		await (await this._projects()).put(project.id, project);
		const warnings = [];
		let agentsMd = { path: path.join(rootPath, "AGENTS.md"), existed: false, created: false, written: false };
		try {
			agentsMd = await ensureProjectAgentsMd({ rootPath, project, content: input.agentsMd ?? null });
		} catch (error) {
			warnings.push(`项目 AGENTS.md 生成失败：${String(error?.message ?? error)}`);
			this.logger?.warn?.(`[project-workbench] ensure AGENTS.md failed: ${String(error?.stack ?? error)}`);
		}
		const instructions = await instructionsFor({ rootPath, taskId: null });
		await this._export(project, warnings);
		return {
			project: summarizeProject(project, statsOf([], this.now()), {
				agentsMdPath: agentsMd.path,
				workbenchRoot: this._workbenchRoot,
			}),
			workbenchRoot: this._workbenchRoot,
			agentsMd,
			instructions,
			warnings,
			actor,
		};
	}

	/**
	 * 更新项目（名称 / 描述 / 归档状态）。归档=只读但可恢复。
	 * @param {string} projectId
	 * @param {{ name?: string, description?: string, status?: 'active'|'archived', actor?: string }} patch
	 */
	async updateProject(projectId, patch = {}) {
		await this._ensureRoot();
		const table = await this._projects();
		const project = await this._projectOrThrow(projectId);
		if (project.status === "archived" && (patch.name !== undefined || patch.description !== undefined)) {
			throw fail("project-archived", `项目「${project.name}」已归档，只读；请先恢复项目再修改名称/描述`);
		}
		const next = { ...project, updatedAt: this.now() };
		if (patch.name !== undefined) next.name = cleanText(patch.name, "name", { required: true, max: 300 });
		if (patch.description !== undefined) next.description = cleanText(patch.description, "description");
		if (patch.status !== undefined) {
			const status = String(patch.status);
			if (status !== "active" && status !== "archived") throw fail("invalid-status", "项目 status 必须是 active / archived");
			if (status !== project.status) {
				next.status = status;
				next.archivedAt = status === "archived" ? this.now() : null;
			}
		}
		await table.update(project.id, () => next);
		const warnings = [];
		await this._export(next, warnings);
		return { project: summarizeProject(next, statsOf(await this._tasksOf(next.id), this.now()), { agentsMdPath: path.join(next.rootPath, "AGENTS.md"), workbenchRoot: this._workbenchRoot }), warnings };
	}

	/**
	 * 删除项目：只允许空项目。
	 * @param {string} projectId
	 */
	async deleteProject(projectId) {
		await this._ensureRoot();
		const project = await this._projectOrThrow(projectId);
		const tasks = await this._tasksOf(project.id);
		if (tasks.length > 0) throw fail("project-not-empty", `项目「${project.name}」仍有 ${tasks.length} 个任务，非空项目不可删除；可改为归档`);
		await (await this._projects()).delete(project.id);
		return { deleted: true, id: project.id, name: project.name };
	}

	/** 导出便携副本（内部，失败只记 warning）。 */
	async _export(project, warnings = []) {
		if (this.config.exportPortableFiles !== false) {
			try {
				const tasks = await this._tasksOf(project.id);
				const instructions = await instructionsFor({ rootPath: project.rootPath, taskId: null });
				const result = await exportPortableCopy({
					rootPath: project.rootPath,
					workbenchRoot: this._workbenchRoot ?? "",
					project,
					tasks: tasks.map((task) => ({ ...task, viewStatus: viewStatusOf(task), taskDir: taskDirPath(project.rootPath, task.id) })),
					stats: statsOf(tasks, this.now()),
					instructions,
					logger: this.logger,
				});
				if (result.ok !== true && typeof result.error === "string") warnings.push(`便携导出失败：${result.error}`);
			} catch (error) {
				warnings.push(`便携导出失败：${String(error?.message ?? error)}`);
			}
		}
		return warnings;
	}

	/* ───────────────────────── 任务 ───────────────────────── */

	/**
	 * 创建任务（默认 backlog）。
	 * @param {{ projectId: string, title: string, description?: string, parentId?: string|null, priority?: string, dueAt?: string|null, agentsMd?: string, actor?: string }} input
	 */
	async createTask(input = {}) {
		await this._ensureRoot();
		const project = await this._projectOrThrow(input.projectId);
		this._assertActive(project);
		const title = cleanText(input.title, "title", { required: true, max: 500 });
		const description = cleanText(input.description, "description");
		const goal = cleanText(input.goal, "goal", { max: MAX_TEXT });
		const priority = parsePriority(input.priority) ?? "medium";
		const dueAt = parseDueAt(input.dueAt) ?? null;
		const actor = input.actor === "agent" ? "agent" : "user";
		let parentId = null;
		if (input.parentId !== undefined && input.parentId !== null && String(input.parentId).trim() !== "") {
			const parent = await this._taskOrThrow(String(input.parentId).trim());
			if (parent.projectId !== project.id) throw fail("invalid-input", "父任务必须属于同一个项目");
			parentId = parent.id;
		}
		const timestamp = this.now();
		const task = {
			id: newId("t"),
			projectId: project.id,
			parentId,
			title,
			description,
			goal,
			status: "backlog",
			priority,
			dueAt,
			createdAt: timestamp,
			updatedAt: timestamp,
			completedAt: null,
			blocked: false,
			waitingReview: false,
			sessionId: null,
			sessionTitle: "",
			sessionCwd: "",
			sessionLinkedAt: null,
			artifacts: [],
			comments: [],
			activity: [
				{
					id: newId("a"),
					at: timestamp,
					actor,
					kind: "task.created",
					detail: `创建任务「${title}」`,
					from: null,
					to: null,
				},
			],
		};
		const warnings = [];
		let taskDir = taskDirPath(project.rootPath, task.id);
		try {
			taskDir = await ensureTaskDir({ rootPath: project.rootPath, taskId: task.id });
		} catch (error) {
			warnings.push(`任务目录创建失败：${String(error?.message ?? error)}`);
			this.logger?.warn?.(`[project-workbench] ensure task dir failed: ${String(error?.stack ?? error)}`);
		}
		if (typeof input.agentsMd === "string" && input.agentsMd.trim() !== "") {
			try {
				const written = await writeTaskAgentsMd({ rootPath: project.rootPath, project, task, content: input.agentsMd });
				task.activity.push({
					id: newId("a"),
					at: timestamp,
					actor,
					kind: "task.agents-md",
					detail: `生成任务级 AGENTS.md：${written.path}`,
					from: null,
					to: written.path,
				});
			} catch (error) {
				warnings.push(`任务 AGENTS.md 生成失败：${String(error?.message ?? error)}`);
				this.logger?.warn?.(`[project-workbench] task AGENTS.md failed: ${String(error?.stack ?? error)}`);
			}
		}
		await (await this._tasks()).put(task.id, task);
		await this._export(project, warnings);
		return { ...(await this.getTask(task.id)), warnings, actor, taskDir };
	}

	/**
	 * 更新任务状态 / 优先级 / 截止时间 / 标题 / 描述 / 阻塞 / 审核标记；
	 * `resolveComments: true` 会一次性解决全部未解决评论（agent 退出 needs-you 的入口）。
	 * @param {string} taskId
	 * @param {object} patch
	 */
	async updateTask(taskId, patch = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const actor = patch.actor === "agent" ? "agent" : "user";
		const timestamp = this.now();
		const nextPatch = {};
		if (patch.title !== undefined) nextPatch.title = cleanText(patch.title, "title", { required: true, max: 500 });
		if (patch.description !== undefined) nextPatch.description = cleanText(patch.description, "description");
		if (patch.goal !== undefined) nextPatch.goal = cleanText(patch.goal, "goal", { max: MAX_TEXT });
		if (patch.status !== undefined) nextPatch.status = parseTaskStatus(patch.status);
		if (patch.priority !== undefined) nextPatch.priority = parsePriority(patch.priority);
		if (patch.dueAt !== undefined) nextPatch.dueAt = parseDueAt(patch.dueAt);
		if (patch.blocked !== undefined) nextPatch.blocked = Boolean(patch.blocked);
		if (patch.waitingReview !== undefined) nextPatch.waitingReview = Boolean(patch.waitingReview);
		const resolveComments = patch.resolveComments === true;
		let written = null;
		if (typeof patch.agentsMd === "string" && patch.agentsMd.trim() !== "") {
			try {
				written = await writeTaskAgentsMd({ rootPath: project.rootPath, project, task, content: patch.agentsMd });
			} catch (error) {
				this.logger?.warn?.(`[project-workbench] task AGENTS.md failed: ${String(error?.stack ?? error)}`);
			}
		}
		const updated = await (await this._tasks()).update(task.id, (current) => {
			const next = { ...current };
			const activity = [...(current.activity ?? [])];
			const push = (kind, detail, from = null, to = null) => {
				activity.push({ id: newId("a"), at: timestamp, actor, kind, detail, from, to });
			};
			if (nextPatch.title !== undefined && nextPatch.title !== next.title) {
				push("task.updated", `标题：「${next.title}」→「${nextPatch.title}」`, next.title, nextPatch.title);
				next.title = nextPatch.title;
			}
			if (nextPatch.description !== undefined && nextPatch.description !== next.description) {
				push("task.updated", "更新任务描述");
				next.description = nextPatch.description;
			}
			if (nextPatch.goal !== undefined && nextPatch.goal !== next.goal) {
				push("task.goal", "更新任务目标");
				next.goal = nextPatch.goal;
			}
			if (nextPatch.status !== undefined && nextPatch.status !== next.status) {
				push("task.status", `状态：${next.status} → ${nextPatch.status}`, next.status, nextPatch.status);
				next.status = nextPatch.status;
				next.completedAt = nextPatch.status === "done" ? timestamp : null;
			}
			if (nextPatch.priority !== undefined && nextPatch.priority !== next.priority) {
				push("task.priority", `优先级：${next.priority} → ${nextPatch.priority}`, next.priority, nextPatch.priority);
				next.priority = nextPatch.priority;
			}
			if (nextPatch.dueAt !== undefined && nextPatch.dueAt !== next.dueAt) {
				push("task.due", `截止时间：${next.dueAt ?? "无"} → ${nextPatch.dueAt ?? "无"}`, next.dueAt, nextPatch.dueAt);
				next.dueAt = nextPatch.dueAt;
			}
			if (nextPatch.blocked !== undefined && nextPatch.blocked !== next.blocked) {
				push("task.blocked", nextPatch.blocked ? "标记为阻塞（进入 needs-you）" : "解除阻塞", String(next.blocked), String(nextPatch.blocked));
				next.blocked = nextPatch.blocked;
			}
			if (nextPatch.waitingReview !== undefined && nextPatch.waitingReview !== next.waitingReview) {
				push("task.review", nextPatch.waitingReview ? "标记为等待审核（进入 needs-you）" : "结束等待审核", String(next.waitingReview), String(nextPatch.waitingReview));
				next.waitingReview = nextPatch.waitingReview;
			}
			if (resolveComments && unresolvedCommentCount(next) > 0) {
				next.comments = (next.comments ?? []).map((comment) =>
					comment.resolved === true ? comment : { ...comment, resolved: true, resolvedAt: timestamp },
				);
				push("comment.resolved", "解决全部未解决评论（退出 needs-you）");
			}
			if (written !== null) push("task.agents-md", `确认任务级 AGENTS.md：${written.path}`, null, written.path);
			next.updatedAt = timestamp;
			next.activity = activity.slice(-500);
			return next;
		});
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(updated.id)), warnings, actor };
	}

	/**
	 * 看板拖拽：写入底层状态；禁止拖入 needs-you。
	 * 从 needs-you 拖出时，同时解除阻塞/审核标记并解决未解决评论（记录活动），
	 * 否则派生条件仍成立、卡片会立刻回到 needs-you。
	 * @param {string} taskId
	 * @param {string} targetStatus backlog|running|done
	 * @param {{ actor?: string }} [options]
	 */
	async moveTask(taskId, targetStatus, { actor: actorInput = "user" } = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		if (targetStatus === "needs-you") throw fail("needs-you-derived", "needs-you 是派生列，不能拖入；它由未解决评论 / 阻塞 / 等待审核自动进入");
		const target = parseTaskStatus(targetStatus);
		const actor = actorInput === "agent" ? "agent" : "user";
		const timestamp = this.now();
		const wasNeedsYou = isNeedsYou(task);
		const updated = await (await this._tasks()).update(task.id, (current) => {
			const next = { ...current };
			const activity = [...(current.activity ?? [])];
			const push = (kind, detail, from = null, to = null) => activity.push({ id: newId("a"), at: timestamp, actor, kind, detail, from, to });
			if (wasNeedsYou) {
				if (next.blocked === true) {
					push("task.blocked", "从 needs-you 拖出：解除阻塞", "true", "false");
					next.blocked = false;
				}
				if (next.waitingReview === true) {
					push("task.review", "从 needs-you 拖出：结束等待审核", "true", "false");
					next.waitingReview = false;
				}
				if (unresolvedCommentCount(next) > 0) {
					next.comments = (next.comments ?? []).map((comment) =>
						comment.resolved === true ? comment : { ...comment, resolved: true, resolvedAt: timestamp },
					);
					push("comment.resolved", "从 needs-you 拖出：自动解决全部未解决评论");
				}
			}
			if (next.status !== target) {
				push("task.status", `看板移动：${next.status} → ${target}`, next.status, target);
				next.status = target;
				next.completedAt = target === "done" ? timestamp : null;
			}
			next.updatedAt = timestamp;
			next.activity = activity.slice(-500);
			return next;
		});
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(updated.id)), warnings, actor };
	}

	/**
	 * 给任务添加评论（默认未解决 → 任务进入 needs-you）。
	 * @param {string} taskId
	 * @param {{ body: string, author?: string, resolved?: boolean, actor?: string }} input
	 */
	async addTaskComment(taskId, input = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const body = cleanText(input.body, "body", { required: true, max: MAX_TEXT });
		const author = cleanText(input.author, "author", { max: 200 }) || "user";
		const actor = input.actor === "agent" ? "agent" : "user";
		const resolved = input.resolved === true;
		const timestamp = this.now();
		const comment = {
			id: newId("c"),
			createdAt: timestamp,
			author,
			body,
			resolved,
			resolvedAt: resolved ? timestamp : null,
		};
		const updated = await (await this._tasks()).update(task.id, (current) => {
			const activity = [
				...(current.activity ?? []),
				{
					id: newId("a"),
					at: timestamp,
					actor,
					kind: "comment.added",
					detail: `${resolved ? "添加已解决评论" : "添加未解决评论"}（${author}）：${body.slice(0, 120)}`,
					from: null,
					to: comment.id,
				},
			];
			return { ...current, comments: [...(current.comments ?? []), comment], updatedAt: timestamp, activity: activity.slice(-500) };
		});
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(updated.id)), comment, warnings };
	}

	/**
	 * 解决 / 重新打开一条评论。
	 * @param {string} taskId
	 * @param {string} commentId
	 * @param {{ resolved?: boolean, actor?: string }} [options]
	 */
	async resolveTaskComment(taskId, commentId, { resolved = true, actor: actorInput = "user" } = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const id = typeof commentId === "string" ? commentId.trim() : "";
		if (id === "") throw fail("invalid-id", "commentId 不能为空");
		const actor = actorInput === "agent" ? "agent" : "user";
		const timestamp = this.now();
		const updated = await (await this._tasks()).update(task.id, (current) => {
			const comments = Array.isArray(current.comments) ? current.comments : [];
			const index = comments.findIndex((comment) => comment.id === id);
			if (index < 0) throw fail("not-found", `评论不存在：${id}`);
			const nextComments = comments.map((comment, position) =>
				position === index ? { ...comment, resolved: resolved === true, resolvedAt: resolved === true ? timestamp : null } : comment,
			);
			const activity = [
				...(current.activity ?? []),
				{
					id: newId("a"),
					at: timestamp,
					actor,
					kind: resolved === true ? "comment.resolved" : "comment.reopened",
					detail: resolved === true ? "解决评论" : "重新打开评论",
					from: null,
					to: id,
				},
			];
			return { ...current, comments: nextComments, updatedAt: timestamp, activity: activity.slice(-500) };
		});
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(updated.id)), warnings };
	}

	/**
	 * 任务详情：项目、父任务、子任务、评论、活动、生效指令层。
	 * @param {string} taskId
	 */
	/** 跨项目任务列表（全部任务页）。 */
	async listAllTasks({ status = "all" } = {}) {
		await this._ensureRoot();
		const projects = await this._allProjects();
		const projectById = new Map(projects.filter((project) => project.status === "active").map((project) => [project.id, project]));
		const tasks = (await this._allTasks())
			.filter((task) => projectById.has(task.projectId))
			.map((task) => ({
				...summarizeTask(task),
				projectName: projectById.get(task.projectId)?.name ?? "",
			}))
			.filter((task) => {
				if (status === "all") return true;
				if (status === "active") return task.viewStatus !== "done";
				if (status === "needs-you") return task.viewStatus === "needs-you";
				if (status === "done") return task.viewStatus === "done";
				return true;
			})
			.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
		return { total: tasks.length, tasks };
	}

	async getTask(taskId) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		const tasks = await this._tasksOf(project.id);
		const parent = task.parentId === null || task.parentId === undefined ? null : tasks.find((item) => item.id === task.parentId) ?? null;
		const children = tasks.filter((item) => item.parentId === task.id);
		const instructions = await instructionsFor({ rootPath: project.rootPath, taskId: task.id });
		const taskDir = taskDirPath(project.rootPath, task.id);
		const goals = (await this._goalsOf(task.id)).map((goal) => this._goalView(goal, task, project));
		return {
			task: summarizeTask(task, { childCount: children.length }),
			session: task.sessionId === null || task.sessionId === undefined ? null : {
				sessionId: task.sessionId,
				title: task.sessionTitle ?? "",
				cwd: task.sessionCwd ?? "",
				linkedAt: task.sessionLinkedAt ?? null,
			},
			artifacts: (task.artifacts ?? []).map((artifact) => this._artifactView(artifact)),
			taskDir,
			goals,
			workbenchRoot: this._workbenchRoot,
			needsYou: isNeedsYou(task),
			needsYouReasons: needsYouReasons(task),
			viewStatus: viewStatusOf(task),
			project: {
				id: project.id,
				name: project.name,
				status: project.status,
				dirName: project.dirName ?? projectDirName(project),
				rootPath: project.rootPath,
				workbenchRoot: this._workbenchRoot,
				agentsMdPath: path.join(project.rootPath, "AGENTS.md"),
			},
			parent: parent === null ? null : { id: parent.id, title: parent.title, status: parent.status, viewStatus: viewStatusOf(parent) },
			children: children.map((item) => ({ id: item.id, title: item.title, status: item.status, viewStatus: viewStatusOf(item) })),
			comments: Array.isArray(task.comments) ? task.comments.map((comment) => ({ ...comment })) : [],
			activity: Array.isArray(task.activity) ? task.activity.slice(-200).map((entry) => ({ ...entry })) : [],
			instructions,
			stats: statsOf(tasks, this.now()),
			raw: { ...task },
		};
	}

	/**
	 * 看板四列视图（needs-you 为派生列）。
	 * @param {string} projectId
	 */
	async board(projectId) {
		await this._ensureRoot();
		const project = await this._projectOrThrow(projectId);
		const tasks = await this._tasksOf(project.id);
		const childrenByParent = this._childrenCounts(tasks);
		const columns = BOARD_COLUMNS.map((key) => ({
			key,
			droppable: key !== "needs-you",
			tasks: tasks
				.filter((task) => viewStatusOf(task) === key)
				.sort(compareTasks)
				.map((task) => summarizeTask(task, { childCount: childrenByParent.get(task.id) ?? 0 })),
		}));
		return {
			project: { id: project.id, name: project.name, status: project.status, dirName: project.dirName ?? projectDirName(project), rootPath: project.rootPath, workbenchRoot: this._workbenchRoot },
			workbenchRoot: this._workbenchRoot,
			columns,
			stats: statsOf(tasks, this.now()),
			enableBoardView: this.config.enableBoardView,
		};
	}

	/* ───────────────────────── 任务会话 / 任务成果 ───────────────────────── */

	/** 给任务绑定一个主会话（一个任务一个主会话）。 */
	async linkTaskSession(taskId, input = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const sessionId = cleanText(input.sessionId, "sessionId", { required: true, max: 200 });
		const title = cleanText(input.title, "title", { max: 300 }) || sessionId;
		const cwd = cleanText(input.cwd, "cwd", { max: 2000 });
		const actor = input.actor === "agent" ? "agent" : "user";
		const timestamp = this.now();
		await (await this._tasks()).update(task.id, (current) => ({
			...current,
			sessionId,
			sessionTitle: title,
			sessionCwd: cwd,
			sessionLinkedAt: timestamp,
			updatedAt: timestamp,
			activity: [...(current.activity ?? []), { id: newId("a"), at: timestamp, actor, kind: "task.session", detail: `绑定任务会话 ${sessionId}`, from: current.sessionId, to: sessionId }].slice(-500),
		}));
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(task.id)), warnings };
	}

	async unlinkTaskSession(taskId) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const timestamp = this.now();
		await (await this._tasks()).update(task.id, (current) => ({
			...current,
			sessionId: null,
			sessionTitle: "",
			sessionCwd: "",
			sessionLinkedAt: null,
			updatedAt: timestamp,
			activity: [...(current.activity ?? []), { id: newId("a"), at: timestamp, actor: "user", kind: "task.session", detail: "解除任务会话绑定", from: current.sessionId, to: null }].slice(-500),
		}));
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(task.id)), warnings };
	}

	/** 上传任务级输入/输出成果。 */
	async uploadTaskArtifact(taskId, input = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const kind = parseArtifactKind(input.kind);
		const name = safeFileName(input.name, "artifact");
		const note = cleanText(input.note, "note", { max: MAX_TEXT });
		const actor = input.actor === "agent" ? "agent" : "user";
		const artifactId = newId("f");
		const dir = taskArtifactsDir(project.rootPath, task.id, kind);
		await mkdir(dir, { recursive: true });
		const target = path.join(dir, `${artifactId}-${name}`);
		const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer ?? []);
		await writeFile(target, buffer);
		const info = await stat(target);
		const timestamp = this.now();
		const artifact = {
			id: artifactId,
			kind,
			name,
			path: target,
			size: info.size,
			mime: cleanText(input.mime, "mime", { max: 200 }) || guessMime(name),
			note,
			createdAt: timestamp,
		};
		const updated = await (await this._tasks()).update(task.id, (current) => ({
			...current,
			artifacts: [...(current.artifacts ?? []), artifact],
			updatedAt: timestamp,
			activity: [...(current.activity ?? []), { id: newId("a"), at: timestamp, actor, kind: "task.artifact", detail: `上传${kind === "input" ? "输入" : "输出"}成果 ${name}`, from: null, to: artifactId }].slice(-500),
		}));
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(updated.id)), artifact, warnings };
	}

	/** 把已有文件登记为任务成果。 */
	async linkTaskArtifact(taskId, input = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const kind = parseArtifactKind(input.kind);
		const rawPath = cleanText(input.path, "path", { required: true, max: 4000 });
		const target = path.isAbsolute(rawPath) ? rawPath : path.resolve(this.cwd, rawPath);
		let info;
		try {
			info = await stat(target);
		} catch {
			throw fail("not-found", `成果文件不存在：${target}`);
		}
		if (!info.isFile()) throw fail("invalid-input", `成果路径不是文件：${target}`);
		const name = cleanText(input.name, "name", { max: 300 }) || path.basename(target);
		const timestamp = this.now();
		const artifact = { id: newId("f"), kind, name, path: target, size: info.size, mime: cleanText(input.mime, "mime", { max: 200 }) || guessMime(name), note: cleanText(input.note, "note", { max: MAX_TEXT }), createdAt: timestamp };
		const updated = await (await this._tasks()).update(task.id, (current) => ({ ...current, artifacts: [...(current.artifacts ?? []), artifact], updatedAt: timestamp }));
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(updated.id)), artifact, warnings };
	}

	/** 扫描任务 inputs/outputs 补登记成果。 */
	async syncTaskArtifacts(taskId) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		const timestamp = this.now();
		const added = [];
		const existing = new Set((task.artifacts ?? []).map((artifact) => path.resolve(artifact.path)));
		for (const kind of ["input", "output"]) {
			const dir = taskArtifactsDir(project.rootPath, task.id, kind);
			let entries = [];
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				entries = [];
			}
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				const full = path.join(dir, entry.name);
				if (existing.has(path.resolve(full))) continue;
				let info;
				try {
					info = await stat(full);
				} catch {
					continue;
				}
				added.push({ id: newId("f"), kind, name: entry.name, path: full, size: info.size, mime: guessMime(entry.name), note: "", createdAt: timestamp });
				existing.add(path.resolve(full));
				if (added.length >= 500) break;
			}
		}
		if (added.length > 0) {
			await (await this._tasks()).update(task.id, (current) => ({ ...current, artifacts: [...(current.artifacts ?? []), ...added], updatedAt: timestamp }));
			const warnings = [];
			await this._export(project, warnings);
		}
		return { ...(await this.getTask(task.id)), added: added.length };
	}

	async deleteTaskArtifact(taskId, artifactId, { deleteFile = false } = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const id = cleanText(artifactId, "artifactId", { required: true, max: 200 });
		const artifact = (task.artifacts ?? []).find((item) => item.id === id);
		if (artifact === undefined) throw fail("not-found", `成果不存在：${id}`);
		await (await this._tasks()).update(task.id, (current) => ({ ...current, artifacts: (current.artifacts ?? []).filter((item) => item.id !== id), updatedAt: this.now() }));
		const managedRoot = taskArtifactsDir(project.rootPath, task.id, artifact.kind);
		const isManaged = isInside(artifact.path, managedRoot);
		if (deleteFile && isManaged) await rm(artifact.path, { force: true }).catch(() => undefined);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getTask(task.id)), deleted: true, id, fileDeleted: deleteFile && isManaged, warnings };
	}

	/* ───────────────────────── 子目标 / 会话 / 产物 ───────────────────────── */

	async _goals() {
		return await this.store.goals();
	}

	async _goalsOf(taskId) {
		const table = await this._goals();
		return [...table.entries()]
			.map(([, goal]) => goal)
			.filter((goal) => goal.taskId === taskId)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
	}

	async _goalOrThrow(goalId) {
		const id = typeof goalId === "string" ? goalId.trim() : "";
		if (id === "") throw fail("invalid-id", "goalId 不能为空");
		const goal = (await this._goals()).get(id);
		if (goal === undefined) throw fail("not-found", `子目标不存在：${id}`);
		return goal;
	}

	async _logTaskActivity(taskId, actor, kind, detail) {
		const timestamp = this.now();
		await (await this._tasks()).update(taskId, (current) => ({
			...current,
			updatedAt: timestamp,
			activity: [
				...(current.activity ?? []),
				{ id: newId("a"), at: timestamp, actor, kind, detail, from: null, to: null },
			].slice(-500),
		}));
	}

	_artifactView(artifact) {
		return {
			...artifact,
			downloadPath: `/workbench-api/artifacts/${encodeURIComponent(artifact.id)}/content`,
			exists: true,
		};
	}

	_goalView(goal, task, project) {
		const dir = goalDirPath(project.rootPath, task.id, goal.id);
		const artifacts = (goal.artifacts ?? []).map((artifact) => this._artifactView(artifact));
		return {
			...goal,
			dir,
			taskDir: taskDirPath(project.rootPath, task.id),
			sessions: goal.sessions ?? [],
			artifacts,
			sessionCount: (goal.sessions ?? []).length,
			artifactCount: artifacts.length,
			inputCount: artifacts.filter((artifact) => artifact.kind === "input").length,
			outputCount: artifacts.filter((artifact) => artifact.kind === "output").length,
		};
	}

	/**
	 * 创建子目标：在任务目录下建 goals/<goalId>/{inputs,outputs}。
	 * @param {string} taskId
	 * @param {{ title: string, description?: string, status?: 'open'|'doing'|'done', actor?: string }} input
	 */
	async createGoal(taskId, input = {}) {
		await this._ensureRoot();
		const task = await this._taskOrThrow(taskId);
		const project = await this._projectOrThrow(task.projectId);
		this._assertActive(project);
		const title = cleanText(input.title, "title", { required: true, max: 300 });
		const description = cleanText(input.description, "description", { max: MAX_TEXT });
		const status = parseGoalStatus(input.status ?? "open");
		const actor = input.actor === "agent" ? "agent" : "user";
		const existing = await this._goalsOf(task.id);
		const order = existing.reduce((max, item) => Math.max(max, item.order ?? 0), 0) + 1;
		const timestamp = this.now();
		const goal = {
			id: newId("g"),
			taskId: task.id,
			projectId: project.id,
			title,
			description,
			status,
			order,
			sessions: [],
			artifacts: [],
			createdAt: timestamp,
			updatedAt: timestamp,
			completedAt: status === "done" ? timestamp : null,
		};
		const dir = goalDirPath(project.rootPath, task.id, goal.id);
		await mkdir(dir, { recursive: true });
		await mkdir(goalArtifactsDir(project.rootPath, task.id, goal.id, "input"), { recursive: true });
		await mkdir(goalArtifactsDir(project.rootPath, task.id, goal.id, "output"), { recursive: true });
		await (await this._goals()).put(goal.id, goal);
		await this._logTaskActivity(task.id, actor, "goal.created", `创建子目标「${title}」`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(goal.id)), warnings, actor };
	}

	/** 按 DSH sessionId 反查任务上下文（供右侧工作台面板）。 */
	async getTaskBySession(sessionId) {
		await this._ensureRoot();
		const id = cleanText(sessionId, "sessionId", { required: true, max: 200 });
		for (const task of await this._allTasks()) {
			if (task.sessionId !== id) continue;
			const detail = await this.getTask(task.id);
			return { task: detail.task, project: detail.project, session: detail.session, artifacts: detail.artifacts, activity: detail.activity, comments: detail.comments, goals: detail.goals, stats: detail.stats, taskId: task.id };
		}
		return { task: null, taskId: null };
	}

	/** 读取子目标详情（含会话、产物与目录）。 */
	async getGoal(goalId) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		return {
			goal: this._goalView(goal, task, project),
			task: { id: task.id, title: task.title, goal: task.goal ?? "", status: task.status, viewStatus: viewStatusOf(task) },
			project: { id: project.id, name: project.name, rootPath: project.rootPath, workbenchRoot: this._workbenchRoot },
			taskDir: taskDirPath(project.rootPath, task.id),
			goalDir: goalDirPath(project.rootPath, task.id, goal.id),
		};
	}

	/** 更新子目标标题/描述/状态/排序。 */
	async updateGoal(goalId, patch = {}) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		const actor = patch.actor === "agent" ? "agent" : "user";
		const timestamp = this.now();
		const next = { ...goal, updatedAt: timestamp };
		if (patch.title !== undefined) next.title = cleanText(patch.title, "title", { required: true, max: 300 });
		if (patch.description !== undefined) next.description = cleanText(patch.description, "description", { max: MAX_TEXT });
		if (patch.order !== undefined) {
			const order = Number(patch.order);
			if (!Number.isFinite(order)) throw fail("invalid-input", "order 必须是数字");
			next.order = Math.max(0, Math.floor(order));
		}
		if (patch.status !== undefined) {
			next.status = parseGoalStatus(patch.status);
			next.completedAt = next.status === "done" ? timestamp : null;
		}
		await (await this._goals()).update(goal.id, () => next);
		await this._logTaskActivity(task.id, actor, "goal.updated", `更新子目标「${next.title}」`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(goal.id)), warnings, actor };
	}

	/** 删除子目标记录（目录保留，避免误删文件）。 */
	async deleteGoal(goalId) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		await (await this._goals()).delete(goal.id);
		await this._logTaskActivity(task.id, "user", "goal.deleted", `删除子目标「${goal.title}」`);
		const warnings = [];
		await this._export(project, warnings);
		return { deleted: true, id: goal.id, title: goal.title, warnings };
	}

	/** 关联一个 DSH 会话到子目标（同一 sessionId 只保留一条）。 */
	async linkGoalSession(goalId, input = {}) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		const sessionId = cleanText(input.sessionId, "sessionId", { required: true, max: 200 });
		const title = cleanText(input.title, "title", { max: 300 });
		const cwd = cleanText(input.cwd, "cwd", { max: 2000 });
		const status = cleanText(input.status, "status", { max: 50 }) || "unknown";
		const source = input.source === "created" ? "created" : "linked";
		const actor = input.actor === "agent" ? "agent" : "user";
		const timestamp = this.now();
		const updated = await (await this._goals()).update(goal.id, (current) => {
			const sessions = Array.isArray(current.sessions) ? current.sessions : [];
			if (sessions.some((session) => session.sessionId === sessionId)) {
				return { ...current, updatedAt: timestamp };
			}
			sessions.push({
				id: newId("s"),
				sessionId,
				title: title || sessionId,
				cwd,
				status,
				source,
				linkedAt: timestamp,
			});
			return { ...current, sessions, updatedAt: timestamp };
		});
		await this._logTaskActivity(task.id, actor, "goal.session", `子目标「${goal.title}」关联会话 ${sessionId}`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(updated.id)), warnings, actor };
	}

	/** 取消子目标与会话的关联（不删除 DSH 会话）。 */
	async unlinkGoalSession(goalId, linkId) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		const id = cleanText(linkId, "linkId", { required: true, max: 200 });
		const updated = await (await this._goals()).update(goal.id, (current) => {
			const sessions = Array.isArray(current.sessions) ? current.sessions : [];
			if (!sessions.some((session) => session.id === id)) throw fail("not-found", `会话关联不存在：${id}`);
			return { ...current, sessions: sessions.filter((session) => session.id !== id), updatedAt: this.now() };
		});
		await this._logTaskActivity(task.id, "user", "goal.session", `子目标「${goal.title}」取消关联会话`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(updated.id)), warnings };
	}

	/**
	 * 上传产物到子目标目录（inputs/ 或 outputs/），并登记产物记录。
	 * @param {string} goalId
	 * @param {{ kind: 'input'|'output', name: string, buffer: Buffer, mime?: string, note?: string, actor?: string }} input
	 */
	async uploadGoalArtifact(goalId, input = {}) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		const kind = parseArtifactKind(input.kind);
		const name = safeFileName(input.name, "artifact");
		const note = cleanText(input.note, "note", { max: MAX_TEXT });
		const actor = input.actor === "agent" ? "agent" : "user";
		const artifactId = newId("f");
		const dir = goalArtifactsDir(project.rootPath, task.id, goal.id, kind);
		await mkdir(dir, { recursive: true });
		const storedName = `${artifactId}-${name}`;
		const target = path.join(dir, storedName);
		const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer ?? []);
		await writeFile(target, buffer);
		const info = await stat(target);
		const timestamp = this.now();
		const artifact = {
			id: artifactId,
			kind,
			name,
			path: target,
			size: info.size,
			mime: cleanText(input.mime, "mime", { max: 200 }) || guessMime(name),
			note,
			createdAt: timestamp,
		};
		const updated = await (await this._goals()).update(goal.id, (current) => ({
			...current,
			artifacts: [...(current.artifacts ?? []), artifact],
			updatedAt: timestamp,
		}));
		await this._logTaskActivity(task.id, actor, "goal.artifact", `子目标「${goal.title}」上传${kind === "input" ? "输入" : "输出"}产物 ${name}`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(updated.id)), artifact, warnings, actor };
	}

	/** 把已有本地文件登记为产物（不复制文件）。 */
	async linkGoalArtifact(goalId, input = {}) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		const kind = parseArtifactKind(input.kind);
		const rawPath = cleanText(input.path, "path", { required: true, max: 4000 });
		const target = path.isAbsolute(rawPath) ? rawPath : path.resolve(this.cwd, rawPath);
		let info;
		try {
			info = await stat(target);
		} catch {
			throw fail("not-found", `产物文件不存在：${target}`);
		}
		if (!info.isFile()) throw fail("invalid-input", `产物路径不是文件：${target}`);
		const name = cleanText(input.name, "name", { max: 300 }) || path.basename(target);
		const note = cleanText(input.note, "note", { max: MAX_TEXT });
		const actor = input.actor === "agent" ? "agent" : "user";
		const timestamp = this.now();
		const artifact = {
			id: newId("f"),
			kind,
			name,
			path: target,
			size: info.size,
			mime: cleanText(input.mime, "mime", { max: 200 }) || guessMime(name),
			note,
			createdAt: timestamp,
		};
		const updated = await (await this._goals()).update(goal.id, (current) => ({
			...current,
			artifacts: [...(current.artifacts ?? []), artifact],
			updatedAt: timestamp,
		}));
		await this._logTaskActivity(task.id, actor, "goal.artifact", `子目标「${goal.title}」登记产物 ${name}`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(updated.id)), artifact, warnings, actor };
	}

	/** 删除产物记录；managed 文件可选一并删除。 */
	async deleteGoalArtifact(goalId, artifactId, { deleteFile = false } = {}) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		this._assertActive(project);
		const id = cleanText(artifactId, "artifactId", { required: true, max: 200 });
		const artifacts = Array.isArray(goal.artifacts) ? goal.artifacts : [];
		const artifact = artifacts.find((item) => item.id === id);
		if (artifact === undefined) throw fail("not-found", `产物不存在：${id}`);
		const updated = await (await this._goals()).update(goal.id, (current) => ({
			...current,
			artifacts: (current.artifacts ?? []).filter((item) => item.id !== id),
			updatedAt: this.now(),
		}));
		const managedRoot = goalArtifactsDir(project.rootPath, task.id, goal.id, artifact.kind);
		const isManaged = isInside(artifact.path, managedRoot);
		if (deleteFile && isManaged) await rm(artifact.path, { force: true }).catch(() => undefined);
		await this._logTaskActivity(task.id, "user", "goal.artifact", `子目标「${goal.title}」删除产物 ${artifact.name}`);
		const warnings = [];
		await this._export(project, warnings);
		return { ...(await this.getGoal(updated.id)), deleted: true, id, fileDeleted: deleteFile && isManaged, warnings };
	}

	/** 扫描子目标 inputs/outputs 目录，把未登记的文件补成产物记录。 */
	async syncGoalArtifacts(goalId) {
		await this._ensureRoot();
		const goal = await this._goalOrThrow(goalId);
		const task = await this._taskOrThrow(goal.taskId);
		const project = await this._projectOrThrow(goal.projectId);
		const timestamp = this.now();
		const added = [];
		const existing = new Set((goal.artifacts ?? []).map((artifact) => path.resolve(artifact.path)));
		for (const kind of ["input", "output"]) {
			const dir = goalArtifactsDir(project.rootPath, task.id, goal.id, kind);
			let entries = [];
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				entries = [];
			}
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				const full = path.join(dir, entry.name);
				if (existing.has(path.resolve(full))) continue;
				let info;
				try {
					info = await stat(full);
				} catch {
					continue;
				}
				added.push({
					id: newId("f"),
					kind,
					name: entry.name,
					path: full,
					size: info.size,
					mime: guessMime(entry.name),
					note: "",
					createdAt: timestamp,
				});
				existing.add(path.resolve(full));
				if (added.length >= 500) break;
			}
		}
		if (added.length > 0) {
			await (await this._goals()).update(goal.id, (current) => ({
				...current,
				artifacts: [...(current.artifacts ?? []), ...added],
				updatedAt: timestamp,
			}));
			await this._logTaskActivity(task.id, "user", "goal.artifact", `子目标「${goal.title}」同步 ${added.length} 个产物`);
			const warnings = [];
			await this._export(project, warnings);
		}
		return { ...(await this.getGoal(goal.id)), added: added.length };
	}

	/** 通过产物 id 找到记录 + 文件路径（下载用）。 */
	async getArtifact(artifactId) {
		await this._ensureRoot();
		const id = cleanText(artifactId, "artifactId", { required: true, max: 200 });
		const taskTable = await this._tasks();
		for (const [, task] of taskTable.entries()) {
			const artifact = (task.artifacts ?? []).find((item) => item.id === id);
			if (artifact === undefined) continue;
			const project = await this._projectOrThrow(task.projectId);
			return { artifact, goal: null, task, project };
		}
		const table = await this._goals();
		for (const [, goal] of table.entries()) {
			const artifact = (goal.artifacts ?? []).find((item) => item.id === id);
			if (artifact === undefined) continue;
			const task = await this._taskOrThrow(goal.taskId);
			const project = await this._projectOrThrow(goal.projectId);
			return { artifact, goal, task, project };
		}
		throw fail("not-found", `产物不存在：${id}`);
	}

	/* ───────────────────────── 首页 Dashboard ───────────────────────── */

	/** 工作台首页聚合：今日待办、项目进度、本周统计、关注事项、最近活动、AI 洞察。 */
	/** 侧边栏角标：当前活跃项目里的待处理 / 逾期 / 任务总数。 */
	async getBadgeCounts() {
		await this._ensureRoot();
		const nowIso = this.now();
		const nowMs = Date.parse(nowIso);
		const projects = await this._allProjects();
		const activeProjectIds = new Set(projects.filter((project) => project.status === "active").map((project) => project.id));
		const tasks = (await this._allTasks()).filter((task) => activeProjectIds.has(task.projectId));
		return {
			needsYou: tasks.filter((task) => isNeedsYou(task)).length,
			overdue: tasks.filter((task) => isOverdueTask(task, nowMs)).length,
			total: tasks.length,
			generatedAt: nowIso,
		};
	}

	async getDashboard() {
		await this._ensureRoot();
		const nowIso = this.now();
		const nowMs = Date.parse(nowIso);
		const projects = await this._allProjects();
		const tasks = await this._allTasks();
		const goalRecords = [...(await this._goals()).entries()].map(([, goal]) => goal);
		const projectById = new Map(projects.map((project) => [project.id, project]));
		const tasksByProject = new Map();
		for (const task of tasks) {
			if (!tasksByProject.has(task.projectId)) tasksByProject.set(task.projectId, []);
			tasksByProject.get(task.projectId).push(task);
		}
		const projectViews = projects
			.filter((project) => project.status === "active")
			.map((project) => {
				const projectTasks = tasksByProject.get(project.id) ?? [];
				const stats = statsOf(projectTasks, nowIso);
				const progress = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
				const lastTaskUpdate = projectTasks.reduce((max, task) => (String(task.updatedAt) > max ? String(task.updatedAt) : max), project.updatedAt);
				return {
					...summarizeProject(project, stats, {
						agentsMdPath: path.join(project.rootPath, "AGENTS.md"),
						workbenchRoot: this._workbenchRoot,
						progress,
						lastUpdated: lastTaskUpdate,
					}),
				};
			})
			.sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)));

		const activeTasks = tasks.filter((task) => !(task.status === "done" && !isNeedsYou(task)));
		const overdue = activeTasks.filter((task) => isOverdueTask(task, nowMs));
		const dueToday = activeTasks.filter((task) => typeof task.dueAt === "string" && task.dueAt !== "" && sameLocalDay(task.dueAt, nowIso));
		const todayIds = new Set();
		const todayTasks = [...overdue, ...dueToday]
			.filter((task) => {
				if (todayIds.has(task.id)) return false;
				todayIds.add(task.id);
				return true;
			})
			.sort(compareTasks)
			.slice(0, 8)
			.map((task) => ({
				...summarizeTask(task),
				projectName: projectById.get(task.projectId)?.name ?? "",
				overdue: isOverdueTask(task, nowMs),
			}));

		const recentTasks = tasks
			.filter((task) => projectById.get(task.projectId)?.status === "active")
			.map((task) => {
				const activity = Array.isArray(task.activity) ? task.activity : [];
				const last = activity.length === 0 ? null : activity[activity.length - 1];
				const lastInteractionAt = getLastInteractionAt(task.sessionId ?? "");
				return {
					...summarizeTask(task),
					projectName: projectById.get(task.projectId)?.name ?? "",
					overdue: isOverdueTask(task, nowMs),
					lastActivityAt: last?.at ?? task.updatedAt,
					lastActivityKind: last?.kind ?? "task",
					lastActivityDetail: last?.detail ?? "创建任务",
					lastInteractionAt: lastInteractionAt === null ? task.updatedAt : new Date(lastInteractionAt).toISOString(),
					lastInteractionKind: lastInteractionAt === null ? "task" : "conversation",
				};
			})
			.sort((a, b) => String(b.lastInteractionAt).localeCompare(String(a.lastInteractionAt)))
			.slice(0, 5);

		const focusItems = tasks
			.filter((task) => isNeedsYou(task) || isOverdueTask(task, nowMs))
			.sort((a, b) => compareTasks(a, b))
			.slice(0, 6)
			.map((task) => ({
				...summarizeTask(task),
				projectName: projectById.get(task.projectId)?.name ?? "",
				overdue: isOverdueTask(task, nowMs),
			}));

		const recentActivity = [];
		for (const task of tasks) {
			const project = projectById.get(task.projectId);
			for (const entry of task.activity ?? []) {
				recentActivity.push({
					id: entry.id,
					at: entry.at,
					actor: entry.actor,
					kind: entry.kind,
					detail: entry.detail,
					taskId: task.id,
					taskTitle: task.title,
					projectId: task.projectId,
					projectName: project?.name ?? "",
				});
			}
		}
		recentActivity.sort((a, b) => String(b.at).localeCompare(String(a.at)));

		const weekStart = startOfLocalWeek(nowMs);
		const completedThisWeek = tasks.filter((task) => typeof task.completedAt === "string" && task.completedAt !== "" && Date.parse(task.completedAt) >= weekStart).length;
		const artifactsThisWeek = goalRecords.reduce((count, goal) => count + (goal.artifacts ?? []).filter((artifact) => Date.parse(artifact.createdAt) >= weekStart).length, 0);
		const sessionsThisWeek = goalRecords.reduce((count, goal) => count + (goal.sessions ?? []).filter((session) => Date.parse(session.linkedAt) >= weekStart).length, 0);
		const activityThisWeek = recentActivity.filter((entry) => Date.parse(entry.at) >= weekStart).length;

		const insights = [];
		const firstOverdue = overdue[0];
		const firstNeedsYou = tasks.find((task) => isNeedsYou(task));
		if (overdue.length > 0) insights.push(`有 ${overdue.length} 个任务已逾期${firstOverdue === undefined ? "" : `，建议优先处理「${firstOverdue.title}」`}。`);
		if (firstNeedsYou !== undefined) insights.push(`有 ${tasks.filter((task) => isNeedsYou(task)).length} 个任务停在 needs-you，等待你的确认或回复。`);
		const leading = projectViews.find((project) => project.progress > 0) ?? projectViews[0];
		if (leading !== undefined) {
			const remaining = leading.stats.total - leading.stats.done;
			insights.push(`「${leading.name}」进度 ${leading.progress}%${remaining > 0 ? `，还有 ${remaining} 个任务未完成` : "，已全部完成"}。`);
		}
		if (completedThisWeek > 0) insights.push(`本周已完成 ${completedThisWeek} 个任务，继续保持。`);
		else insights.push("本周还没有完成任务，可以先从今日待办开始。");
		if (artifactsThisWeek > 0) insights.push(`本周新增 ${artifactsThisWeek} 个输入/输出产物。`);

		return {
			workbenchRoot: this._workbenchRoot,
			generatedAt: nowIso,
			stats: statsOf(tasks, nowIso),
			projectCount: projects.length,
			activeProjectCount: projectViews.length,
			projects: projectViews.slice(0, 5),
			todayTasks,
			recentTasks,
			focusItems,
			recentActivity: recentActivity.slice(0, 12),
			weekly: {
				completed: completedThisWeek,
				artifacts: artifactsThisWeek,
				sessions: sessionsThisWeek,
				activity: activityThisWeek,
			},
			insights: insights.slice(0, 4),
		};
	}

	/* ───────────────────────── 工作台设置 / 根目录迁移 ───────────────────────── */

	/** 当前工作台设置与规模统计。 */
	async getSettings() {
		await this._ensureRoot();
		const settings = await this.store.settings();
		const stored = settings.get();
		const projects = await this._allProjects();
		const tasks = await this._allTasks();
		return {
			workbenchRoot: this._workbenchRoot,
			source: stored.source,
			explicitConfig: this.config.workbenchRootExplicit,
			projectCount: projects.length,
			archivedProjectCount: projects.filter((project) => project.status === "archived").length,
			taskCount: tasks.length,
			defaultWorkbenchRoot: resolveWorkbenchRoot(DEFAULT_WORKBENCH_ROOT, this.cwd),
		};
	}

	/**
	 * 修改工作台根目录并自动迁移所有项目目录 + 记录 rootPath。
	 * @param {string} newRoot
	 */
	async changeWorkbenchRoot(newRoot) {
		await this._ensureRoot();
		const target = resolveWorkbenchRoot(newRoot, this.cwd);
		if (target === path.parse(target).root) throw fail("invalid-input", "工作台根目录不能是文件系统根目录");
		const settings = await this.store.settings();
		const oldRoot = this._workbenchRoot;
		if (isSamePath(target, oldRoot)) {
			await settings.set({ rootPath: target, source: "user" });
			return { ...(await this.getSettings()), migrated: false, movedProjects: [] };
		}
		if (isInside(target, oldRoot) || isInside(oldRoot, target)) {
			throw fail("root-migration-failed", "新工作台根目录不能与当前根目录互相嵌套");
		}
		const projects = await this._allProjects();
		await this._migrateTo(target, oldRoot);
		await mkdirRecursive(target);
		await settings.set({ rootPath: target, source: "user" });
		this._workbenchRoot = target;
		const warnings = [];
		for (const project of await this._allProjects()) {
			const refreshed = (await this._projects()).get(project.id);
			if (refreshed !== undefined) await this._export(refreshed, warnings);
		}
		return {
			...(await this.getSettings()),
			migrated: true,
			from: oldRoot,
			movedProjects: projects.length,
			warnings,
		};
	}

	/* ───────────────────────── 内部工具 ───────────────────────── */

	_childrenCounts(tasks) {
		const counts = new Map();
		for (const task of tasks) {
			if (task.parentId === null || task.parentId === undefined) continue;
			counts.set(task.parentId, (counts.get(task.parentId) ?? 0) + 1);
		}
		return counts;
	}

	_filterTasks(tasks, status) {
		const filter = typeof status === "string" && status.trim() !== "" ? status.trim() : "all";
		if (filter === "all") return [...tasks].sort(compareTasks);
		if (!BOARD_COLUMNS.includes(filter)) throw fail("invalid-status", `任务筛选必须是 all / ${BOARD_COLUMNS.join(" / ")}`);
		return tasks.filter((task) => viewStatusOf(task) === filter).sort(compareTasks);
	}
}
