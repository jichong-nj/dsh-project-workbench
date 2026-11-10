/**
 * test/helpers.mjs — 离线测试脚手架：内存 domain 表 + 临时目录 + 断言。
 *
 * 不依赖 running DSH：用与 storageDomain 表同形状的内存表喂 WorkbenchService，
 * 用临时目录承接 AGENTS.md / .dsh-project-workbench 文件副作用。
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 与 KvTable 同形状的内存表。 */
export function memoryTable() {
	const map = new Map();
	let chain = Promise.resolve();
	const enqueue = (fn) => {
		const run = chain.then(fn, fn);
		chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
	return {
		get: (key) => map.get(key),
		entries: () => map.entries(),
		keys: () => map.keys(),
		get size() {
			return map.size;
		},
		put: (key, value) =>
			enqueue(() => {
				map.set(key, value);
				return undefined;
			}),
		delete: (key) => enqueue(() => map.delete(key)),
		update: (key, fn) =>
			enqueue(() => {
				if (!map.has(key)) throw new Error(`missing-key: ${key}`);
				const next = fn(map.get(key));
				map.set(key, next);
				return next;
			}),
		_raw: map,
	};
}

/** 假 store：projects()/tasks()/settings() 返回内存句柄。 */
export function fakeStore() {
	const projects = memoryTable();
	const tasks = memoryTable();
	const goals = memoryTable();
	let settingsValue = { rootPath: "", source: "config" };
	const settings = {
		get: () => settingsValue,
		set: async (value) => {
			settingsValue = { ...value };
		},
	};
	return {
		projects: async () => projects,
		tasks: async () => tasks,
		goals: async () => goals,
		settings: async () => settings,
		_projects: projects,
		_tasks: tasks,
		_goals: goals,
		_settings: settings,
	};
}

/** 临时目录，返回 { dir, cleanup }。 */
export async function tempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), "dsh-project-workbench-"));
	return {
		dir,
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true });
		},
	};
}

/** 简易测试运行器。 */
export function createRunner(title) {
	const cases = [];
	const test = (name, fn) => cases.push({ name, fn });
	const run = async () => {
		let passed = 0;
		for (const item of cases) {
			try {
				await item.fn();
				passed += 1;
				console.log(`  ✓ ${title} › ${item.name}`);
			} catch (error) {
				console.error(`  ✗ ${title} › ${item.name}`);
				throw error;
			}
		}
		console.log(`  ${title}: ${passed}/${cases.length} passed`);
		return { title, passed, total: cases.length };
	};
	return { test, run };
}

export { assert };
