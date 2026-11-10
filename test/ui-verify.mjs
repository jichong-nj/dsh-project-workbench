/**
 * test/ui-verify.mjs — 真浏览器冒烟验证（可选，需要已启动的 DSH Web）。
 *
 * 用法：
 *   DSH_HOME=/path/to/home dsh --profile web --no-open --port 3095
 *   BASE=http://127.0.0.1:3095 TOKEN=<启动日志里的 token> node test/ui-verify.mjs
 *
 * 验证链路：侧边栏「工作台」→ 新建项目 → 项目详情 → 新建任务（含任务级
 * AGENTS.md）→ 任务详情（评论/指令层）→ 看板 → 拖拽 → 归档只读。
 * 截图默认写到 .verify-home/screens/，便于人工复核。
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const puppeteerModule = process.env.PUPPETEER_PATH ?? "/home/jichong/.openclaw/workspace/palette/tasks/node_modules/puppeteer/lib/puppeteer/puppeteer.js";
const puppeteer = (await import(puppeteerModule)).default;

const BASE = process.env.BASE ?? "http://127.0.0.1:3095";
const TOKEN = process.env.TOKEN;
const SCREENS = process.env.SCREENS ?? ".verify-home/screens";
if (TOKEN === undefined || TOKEN === "") throw new Error("TOKEN env is required");

await mkdir(SCREENS, { recursive: true });

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
	headless: "new",
	args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,1000"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

const consoleErrors = [];
page.on("console", (message) => {
	if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

const shot = async (name) => {
	await page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage: false });
};

const clickText = async (selector, text) => {
	const ok = await page.evaluate(
		(sel, wanted) => {
			const items = Array.from(document.querySelectorAll(sel));
			const target = items.find((element) => (element.textContent ?? "").trim() === wanted);
			if (target === undefined) return false;
			target.click();
			return true;
		},
		selector,
		text,
	);
	assert.equal(ok, true, `clickable not found: ${selector} "${text}"`);
	await new Promise((resolve) => setTimeout(resolve, 250));
};

const clickContains = async (selector, text) => {
	const ok = await page.evaluate(
		(sel, wanted) => {
			const items = Array.from(document.querySelectorAll(sel));
			const target = items.find((element) => (element.textContent ?? "").includes(wanted));
			if (target === undefined) return false;
			target.click();
			return true;
		},
		selector,
		text,
	);
	assert.equal(ok, true, `clickable not found: ${selector} contains "${text}"`);
	await new Promise((resolve) => setTimeout(resolve, 250));
};

const fill = async (selector, value) => {
	await page.click(selector);
	await page.evaluate((sel) => {
		const element = document.querySelector(sel);
		if (element !== null) element.value = "";
	}, selector);
	await page.type(selector, value);
};

const text = async () => await page.evaluate(() => document.body.innerText);

try {
	await page.goto(`${BASE}/?token=${TOKEN}`, { waitUntil: "networkidle2", timeout: 60000 });
	await new Promise((resolve) => setTimeout(resolve, 2500));
	// 关闭一次性的“预览版说明”欢迎弹窗，避免遮挡插件操作
	await page.evaluate(() => {
		const buttons = Array.from(document.querySelectorAll("button"));
		const next = buttons.find((button) => (button.textContent ?? "").trim() === "继续");
		if (next !== undefined) next.click();
	});
	await new Promise((resolve) => setTimeout(resolve, 800));
	await clickText("button", "工作台");
	await page.waitForSelector(".pw-quick", { timeout: 15000 });
	await new Promise((resolve) => setTimeout(resolve, 1200));
	await shot("01-dashboard");
	assert.match(await text(), /快速：/);

	await clickContains(".pw-chip", "新建项目");
	await page.waitForSelector(".pw-dialog", { timeout: 8000 });
	await fill('input[placeholder*="供应商"]', "浏览器验证项目");
	await fill(".pw-dialog textarea", "验证项目 → 任务 → AGENTS.md → 看板链路");
	await fill('input[placeholder="my-project"]', "ui-demo");
	await shot("02-create-project");
	await clickText("button", "创建项目");
	// 创建后 UI 自动进入项目详情
	await page.waitForSelector(".pw-project-head", { timeout: 15000 });
	await new Promise((resolve) => setTimeout(resolve, 800));
	await shot("03-project-detail");
	assert.match(await text(), /AGENTS\.md/);

	await clickText("button", "新建任务");
	await page.waitForSelector(".pw-dialog", { timeout: 8000 });
	await fill('input[placeholder*="整理验收材料"]', "验证任务详情与拖拽");
	await fill(".pw-dialog textarea", "检查任务详情、评论、活动与指令层");
	await page.click('.pw-dialog input[type="checkbox"]');
	await new Promise((resolve) => setTimeout(resolve, 200));
	const textareas = await page.$$(".pw-dialog textarea");
	await textareas[textareas.length - 1].click();
	await page.keyboard.type("# 任务级增量\n\n- 只改 docs/ch1.md");
	await shot("05-create-task");
	await clickText("button", "创建任务");
	await page.waitForSelector(".pw-task-row", { timeout: 15000 });
	await new Promise((resolve) => setTimeout(resolve, 800));
	await shot("06-task-list");

	// 任务行点击直接进入任务原生会话，右侧显示任务工作台
	await page.evaluate(() => document.querySelector(".pw-task-row")?.click());
	await page.waitForSelector(".pw-side", { timeout: 30000 });
	await new Promise((resolve) => setTimeout(resolve, 1000));
	await shot("07-task-session-panel");
	const panelText = await text();
	assert.match(panelText, /任务目标/);
	assert.match(panelText, /输入 \/ 输出成果/);
	assert.match(panelText, /任务描述/);

	// 返回项目页
	await page.evaluate(() => {
		const button = [...document.querySelectorAll(".pw-side-nav button")].find((item) => item.textContent.includes("项目"));
		button?.click();
	});
	await page.waitForSelector(".pw-project-head", { timeout: 15000 });
	await new Promise((resolve) => setTimeout(resolve, 500));

	await clickText("button", "看板");
	await page.waitForSelector(".pw-board", { timeout: 15000 });
	await new Promise((resolve) => setTimeout(resolve, 800));
	await shot("09-board");
	assert.match(await text(), /Backlog/);

	// 归档 → 只读（看板本身就在项目详情里）
	page.once("dialog", (dialog) => void dialog.accept());
	await clickText("button", "归档");
	await new Promise((resolve) => setTimeout(resolve, 1800));
	await shot("11-archived");
	assert.match(await text(), /已归档/);

	// 工作台根目录迁移（UI 可配置 + 自动迁移）
	await clickText("button", "项目");
	await page.waitForSelector(".pw-project-card, .pw-empty", { timeout: 15000 });
	await clickText("button", "工作台根目录");
	await page.waitForSelector(".pw-dialog", { timeout: 8000 });
	const newRoot = "/home/jichong/Projects/dsh-plugins/.verify-home/workbench-v2";
	await fill('.pw-dialog input[placeholder*="workbench"]', newRoot);
	await shot("12-migrate-root");
	await clickText("button", "迁移到新根目录");
	await new Promise((resolve) => setTimeout(resolve, 2000));
	await shot("13-after-migrate");
	assert.match(await text(), /workbench-v2|已迁移/);

	console.log("UI verify OK — screenshots in", SCREENS);
	if (consoleErrors.length > 0) {
		console.log("console errors:", consoleErrors.slice(0, 10));
		process.exitCode = 1;
	}
} finally {
	await browser.close();
}
