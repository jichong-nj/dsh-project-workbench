/**
 * test/run-all.mjs — 一键运行全部 host 离线契约测试。
 *
 * 本 DSH 构建没有 `dsh-dev` CLI（已确认 PATH 与全局包中都不存在）；
 * 因此用 node 原生测试脚本代替 `dsh-dev check/test`：
 *   node test/run-all.mjs
 */

import domainRun from "./domain.test.mjs";
import serviceRun from "./service.test.mjs";
import toolsRun from "./tools.test.mjs";
import apiRun from "./api.test.mjs";
import clientRun from "./client.test.mjs";
import assistantRun from "./assistant.test.mjs";

const runs = [domainRun, serviceRun, toolsRun, apiRun, assistantRun, clientRun];

const started = Date.now();
let total = 0;
let passed = 0;

console.log("dsh-project-workbench — host contract tests\n");
for (const run of runs) {
	const result = await run();
	total += result.total;
	passed += result.passed;
}

const elapsed = ((Date.now() - started) / 1000).toFixed(2);
if (passed !== total) {
	console.error(`\nFAILED: ${passed}/${total} passed in ${elapsed}s`);
	process.exitCode = 1;
} else {
	console.log(`\nOK: ${passed}/${total} passed in ${elapsed}s`);
}
