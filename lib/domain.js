/**
 * lib/domain.js — storageDomain 声明与主存储句柄。
 *
 * 主读写全部走 `ctx.storageDomain`（@deepseek-ai/dsh-storage-domain）：
 *   逻辑域 `workbench.projects` → 物理域名 `workbench_projects`
 *   逻辑域 `workbench.tasks`    → 物理域名 `workbench_tasks`
 *
 * 为什么不是字面量 `workbench.projects`：storage-domain 用 `UNIT_NAME_RE`
 * (`/^[a-z][a-z0-9_]*$/`) 校验域名与表名，点号不合法（见
 * @deepseek-ai/dsh-storage 的 UNIT_NAME_RE）。这里保留逻辑名常量，
 * 并在 README / CONTRACTS 中说明映射，避免上层代码散落魔法字符串。
 *
 * @module lib/domain
 */

import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";

/** 逻辑域名（产品口径）→ 物理域名（storageDomain 口径）。 */
export const DOMAIN_NAMES = Object.freeze({
	projects: "workbench_projects",
	tasks: "workbench_tasks",
});

/** 逻辑域名（仅用于文档与诊断展示）。 */
export const LOGICAL_DOMAIN_NAMES = Object.freeze({
	projects: "workbench.projects",
	tasks: "workbench.tasks",
});

/** 项目状态。 */
export const PROJECT_STATUSES = Object.freeze(["active", "archived"]);

/** 任务底层 workflow 状态；needs-you 是派生视图，不在这个枚举里。 */
export const TASK_STATUSES = Object.freeze(["backlog", "running", "done"]);

/** 看板四列（含派生列 needs-you）。 */
export const BOARD_STATUSES = Object.freeze(["backlog", "running", "needs-you", "done"]);

/** 任务优先级。 */
export const TASK_PRIORITIES = Object.freeze(["low", "medium", "high", "urgent"]);

/** 活动记录行为方。 */
export const ACTIVITY_ACTORS = Object.freeze(["agent", "user", "system"]);

const commentSchema = z.object({
	id: z.string().min(1).max(200),
	createdAt: z.string(),
	author: z.string().default("user"),
	body: z.string(),
	resolved: z.boolean().default(false),
	resolvedAt: z.string().nullable().default(null),
});

const activitySchema = z.object({
	id: z.string().min(1).max(200),
	at: z.string(),
	actor: z.enum(["agent", "user", "system"]),
	kind: z.string(),
	detail: z.string(),
	from: z.string().nullable().default(null),
	to: z.string().nullable().default(null),
});

/** 工作台设置（projects domain 的 global 槽）。 */
export const workbenchSettingsSchema = z.object({
	/** 当前工作台根目录；空串表示尚未初始化。 */
	rootPath: z.string().default(""),
	/** `config` = 由插件配置决定；`user` = 用户在 UI 里迁移过，配置缺省时以它为准。 */
	source: z.enum(["config", "user"]).default("config"),
});

/** 项目记录（`workbench_projects.projects`）。 */
export const projectRecordSchema = z.object({
	id: z.string().min(1).max(200),
	name: z.string().min(1).max(300),
	description: z.string().default(""),
	/** 工作台根目录下的一级目录名（由插件生成或用户指定的 folderName）。 */
	dirName: z.string().default(""),
	/** 项目根 = workbenchRoot / dirName；迁移时会更新。 */
	rootPath: z.string().min(1),
	status: z.enum(["active", "archived"]).default("active"),
	createdAt: z.string(),
	updatedAt: z.string(),
	archivedAt: z.string().nullable().default(null),
});

const goalSessionSchema = z.object({
	id: z.string().min(1).max(200),
	sessionId: z.string().min(1).max(200),
	title: z.string().default(""),
	cwd: z.string().default(""),
	status: z.string().default("unknown"),
	source: z.enum(["linked", "created"]).default("linked"),
	linkedAt: z.string(),
});

export const artifactRecordSchema = z.object({
	id: z.string().min(1).max(200),
	kind: z.enum(["input", "output"]),
	name: z.string().min(1).max(300),
	path: z.string().min(1),
	size: z.number().int().nonnegative().default(0),
	mime: z.string().default("application/octet-stream"),
	note: z.string().default(""),
	createdAt: z.string(),
});

/** 子目标记录（`workbench_tasks.goals`）。 */
export const goalRecordSchema = z.object({
	id: z.string().min(1).max(200),
	taskId: z.string().min(1).max(200),
	projectId: z.string().min(1).max(200),
	title: z.string().min(1).max(300),
	description: z.string().default(""),
	status: z.enum(["open", "doing", "done"]).default("open"),
	order: z.number().int().default(0),
	sessions: z.array(goalSessionSchema).default([]),
	artifacts: z.array(artifactRecordSchema).default([]),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().nullable().default(null),
});

/** 任务记录（`workbench_tasks.tasks`）。 */
export const taskRecordSchema = z.object({
	id: z.string().min(1).max(200),
	projectId: z.string().min(1).max(200),
	parentId: z.string().min(1).max(200).nullable().default(null),
	title: z.string().min(1).max(500),
	description: z.string().default(""),
	goal: z.string().default(""),
	status: z.enum(["backlog", "running", "done"]).default("backlog"),
	priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
	dueAt: z.string().nullable().default(null),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().nullable().default(null),
	blocked: z.boolean().default(false),
	waitingReview: z.boolean().default(false),
	sessionId: z.string().min(1).max(200).nullable().default(null),
	sessionTitle: z.string().default(""),
	sessionCwd: z.string().default(""),
	sessionLinkedAt: z.string().nullable().default(null),
	artifacts: z.array(artifactRecordSchema).default([]),
	comments: z.array(commentSchema).default([]),
	activity: z.array(activitySchema).default([]),
});

/** 项目 domain 声明（含工作台根目录设置）。 */
export const projectsDomainSpec = defineDomain({
	name: DOMAIN_NAMES.projects,
	version: 1,
	tables: {
		projects: domainTable(projectRecordSchema),
	},
	global: {
		schema: workbenchSettingsSchema,
		initial: { rootPath: "", source: "config" },
	},
});

/** 任务 domain 声明。 */
export const tasksDomainSpec = defineDomain({
	name: DOMAIN_NAMES.tasks,
	version: 1,
	tables: {
		tasks: domainTable(taskRecordSchema),
		goals: domainTable(goalRecordSchema),
	},
});

/**
 * 打开两个 domain 并返回句柄；任一失败都会关闭已打开的那个。
 * @param {import('@deepseek-ai/dsh-storage-domain').DomainFacility} facility `ctx.storageDomain`
 * @returns {Promise<{ projects: import('@deepseek-ai/dsh-storage-domain').Domain<typeof projectsDomainSpec>, tasks: import('@deepseek-ai/dsh-storage-domain').Domain<typeof tasksDomainSpec>, close: () => Promise<void> }>}
 */
export async function openWorkbenchDomains(facility) {
	const projects = await facility.open(projectsDomainSpec);
	let tasks;
	try {
		tasks = await facility.open(tasksDomainSpec);
	} catch (error) {
		await projects.close().catch(() => undefined);
		throw error;
	}
	let closed = false;
	return {
		projects,
		tasks,
		async close() {
			if (closed) return;
			closed = true;
			await Promise.allSettled([tasks.close(), projects.close()]);
		},
	};
}

/**
 * 主存储仓库：对 domain 表的薄封装，所有写操作都走 domain 的 put/update。
 *
 * 单独抽出来是为了让 service 可以针对接口测试（内存 fake 表），也避免把
 * storageDomain 细节散落在工具与 HTTP 层。
 */
export class WorkbenchStore {
	/**
	 * @param {{ open: () => Promise<{ projects: any, tasks: any }> }} options
	 */
	constructor({ open }) {
		this._open = open;
		this._handles = null;
		this._opening = null;
	}

	/** 确保 domain 已打开；失败抛 storage-unavailable。 */
	async ready() {
		if (this._handles !== null) return this._handles;
		if (this._opening === null) {
			this._opening = this._open().then(
				(handles) => {
					this._handles = handles;
					return handles;
				},
				(error) => {
					this._opening = null;
					throw error;
				},
			);
		}
		return await this._opening;
	}

	/** 项目表。 */
	async projects() {
		const handles = await this.ready();
		return handles.projects.table("projects");
	}

	/** 工作台设置 global（projects domain 的 global 槽）。 */
	async settings() {
		const handles = await this.ready();
		return handles.projects.global;
	}

	/** 任务表。 */
	async tasks() {
		const handles = await this.ready();
		return handles.tasks.table("tasks");
	}

	/** 子目标表。 */
	async goals() {
		const handles = await this.ready();
		return handles.tasks.table("goals");
	}

	/** 关闭（幂等）。 */
	async close() {
		const handles = this._handles;
		this._handles = null;
		this._opening = null;
		if (handles !== null && typeof handles.close === "function") await handles.close();
	}
}
