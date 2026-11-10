/**
 * test/client.test.mjs — 浏览器端 bundle 的加载契约与纯函数。
 *
 * 不启动 DOM / 浏览器：用最小 window.__ModuleLoader__ 捕获 factory 的返回值，
 * 检查 slots 注册与纯函数（模板、时间换算、need-you 文案等）。
 * 真实渲染在挂载到 DSH Web 后人工验证。
 */

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const clientPath = path.join(process.cwd(), "client.js");
const url = `${pathToFileURL(clientPath).href}?v=${Date.now()}`;

let captured = null;
Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true, writable: true });
globalThis.window = {
	__ModuleLoader__: {
		load(options) {
			captured = options;
		},
	},
};

// node 的 ESM import 带缓存，这里用 query 保证只执行一次；factory 在 import 时同步调用。
const react = await import("react");
const factoryRequire = (name) => {
	if (name === "react") return react;
	throw new Error(`unexpected require: ${name}`);
};
await import(url);
assert.ok(captured !== null, "client bundle must call window.__ModuleLoader__.load");
assert.equal(captured.id, "@jichong/dsh-project-workbench");
const mod = captured.factory(factoryRequire);

const runner = (await import("./helpers.mjs")).createRunner("client");
const { test } = runner;

test("模块形状：name / inject / apply / __test", () => {
	assert.equal(mod.name, "project-workbench");
	assert.deepEqual(mod.inject, ["slots", "sidebarRightTabs", "sidebarRight", "layout"]);
	assert.equal(typeof mod.apply, "function");
	assert.equal(typeof mod.__test, "object");
	assert.deepEqual(mod.__test.BOARD_COLUMNS, ["backlog", "running", "needs-you", "done"]);
});

test("apply 注册 sidebar.panellist 与 main slot", () => {
	const registrations = [];
	const ctx = {
		get() {
			return undefined;
		},
		effect(fn) {
			const dispose = fn();
			return typeof dispose === "function" ? dispose : () => undefined;
		},
		slots: {
			inject(name, callback) {
				return callback();
			},
			register(options, component) {
				registrations.push({ options, component });
				return () => undefined;
			},
		},
	};
	mod.apply(ctx);
	assert.equal(registrations.length, 3);
	const panel = registrations.find((item) => item.options.name === "sidebar.panellist");
	const main = registrations.find((item) => item.options.name === "main");
	const back = registrations.find((item) => item.options.name === "conversation.session.header.actions");
	assert.ok(panel !== undefined);
	assert.ok(main !== undefined);
	assert.ok(back !== undefined);
	assert.equal(panel.options.id, "project-workbench");
	assert.equal(panel.options.locale, "project-workbench");
	assert.equal(typeof panel.options.label, "function");
	assert.equal(typeof panel.component, "function");
	assert.equal(main.options.key, "project-workbench");
	assert.equal(typeof main.component, "function");
});

test("buildProjectTemplate 含项目名/背景/通用规则/工作台", () => {
	const text = mod.__test.buildProjectTemplate("验收项目", "整理验收材料");
	assert.match(text, /# 项目：验收项目/);
	assert.match(text, /整理验收材料/);
	assert.match(text, /## 通用规则/);
	assert.match(text, /## 工作台/);
	assert.match(text, /AGENTS\.md/);
});

test("时间换算：datetime-local ↔ ISO", () => {
	const local = "2026-12-31T18:30";
	const iso = mod.__test.fromLocalInput(local);
	assert.ok(iso.endsWith("Z"));
	assert.equal(mod.__test.toLocalInput(iso), local);
	assert.equal(mod.__test.fromLocalInput(""), "");
	assert.equal(mod.__test.toLocalInput(null), "");
});

test("逾期判断", () => {
	assert.equal(mod.__test.isOverdue({ dueAt: "2000-01-01T00:00:00.000Z", status: "running" }), true);
	assert.equal(mod.__test.isOverdue({ dueAt: "2999-01-01T00:00:00.000Z", status: "running" }), false);
	assert.equal(mod.__test.isOverdue({ dueAt: "2000-01-01T00:00:00.000Z", status: "done" }), false);
	assert.equal(mod.__test.isOverdue({ dueAt: null, status: "running" }), false);
});

test("needs-you 原因文案与活动标签", () => {
	assert.match(mod.__test.needsYouReasonText({ code: "unresolved-comments", count: 2 }), /2/);
	assert.equal(typeof mod.__test.needsYouReasonText({ code: "blocked", label: "已标记阻塞" }), "string");
	const label = mod.__test.activityKindLabel("task.status");
	assert.equal(typeof label, "string");
	assert.ok(label.length > 0);
});

test("文案字典可切换英文（直接调用 t）", () => {
	// 默认 navigator 是 zh-CN
	assert.equal(mod.__test.t("panel.title"), "工作台");
});

const result = await runner.run();
export default async () => result;
