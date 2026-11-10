/**
 * test/assistant.test.mjs — 首页 AI 助手：模型调用、工具调用、错误处理。
 */

import path from "node:path";

import { createAssistantService } from "../lib/assistant.js";
import { WorkbenchService } from "../lib/service.js";
import { assert, createRunner, fakeStore, tempDir } from "./helpers.mjs";

const runner = createRunner("assistant");

function fakeLlm(scripts) {
	let call = 0;
	return {
		listProviders: () => [{ id: "fake" }],
		listModels: async () => [{ id: "fake-model" }],
		resolveModelInfo: async () => ({ defaultMaxTokens: 4096 }),
		stream(options) {
			const chunks = scripts[call] ?? [];
			call += 1;
			return (async function* generate() {
				for (const chunk of chunks) yield chunk;
			})();
		},
		_calls: () => call,
	};
}

async function setup(scripts) {
	const store = fakeStore();
	const tmp = await tempDir();
	const service = new WorkbenchService({
		store,
		config: { workbenchRoot: path.join(tmp.dir, "workbench"), workbenchRootExplicit: true, exportPortableFiles: false },
		cwd: tmp.dir,
	});
	const llm = fakeLlm(scripts);
	const assistant = createAssistantService({
		service,
		getLlm: () => llm,
		getDefaultModel: () => ({ currentSelection: () => ({ provider: "fake", model: "fake-model" }) }),
		logger: { warn: () => undefined },
	});
	return { store, service, llm, assistant, tmp };
}

runner.test("普通对话：返回文本，不执行工具", async () => {
	const { assistant, tmp } = await setup([[{ type: "text-delta", index: 0, text: "你好，今天没有待办。" }, { type: "finish", reason: { kind: "stop" } }]]);
	try {
		const result = await assistant.chat({ message: "今天要做什么？", history: [] });
		assert.match(result.reply, /你好/);
		assert.deepEqual(result.actions, []);
	} finally {
		await tmp.cleanup();
	}
});

runner.test("工具调用：AI 创建项目并返回动作", async () => {
	const scripts = [
		[
			{ type: "tool-call-delta", index: 0, id: "call-1", name: "workbench_create_project", argumentsDelta: JSON.stringify({ name: "AI 创建的项目" }) },
			{ type: "finish", reason: { kind: "tool-calls" } },
		],
		[{ type: "text-delta", index: 0, text: "已创建项目「AI 创建的项目」。" }, { type: "finish", reason: { kind: "stop" } }],
	];
	const { assistant, store, tmp } = await setup(scripts);
	try {
		const result = await assistant.chat({ message: "帮我创建一个项目 AI 创建的项目", history: [] });
		assert.match(result.reply, /已创建/);
		assert.equal(result.actions.length, 1);
		assert.equal(result.actions[0].tool, "workbench_create_project");
		assert.equal([...store._projects.entries()].length, 1);
		assert.equal([...store._projects.entries()][0][1].name, "AI 创建的项目");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("工具调用：查询项目列表", async () => {
	const scripts = [
		[
			{ type: "tool-call-delta", index: 0, id: "call-2", name: "workbench_list_projects", argumentsDelta: "{}" },
			{ type: "finish", reason: { kind: "tool-calls" } },
		],
		[{ type: "text-delta", index: 0, text: "当前没有项目。" }, { type: "finish", reason: { kind: "stop" } }],
	];
	const { assistant, tmp } = await setup(scripts);
	try {
		const result = await assistant.chat({ message: "现在有哪些项目？", history: [] });
		assert.match(result.reply, /没有项目/);
		assert.equal(result.actions[0].tool, "workbench_list_projects");
	} finally {
		await tmp.cleanup();
	}
});

runner.test("模型不可用：返回可读错误", async () => {
	const { assistant, tmp } = await setup([]);
	try {
		const broken = createAssistantService({ service: (await import("../lib/service.js")).WorkbenchService, getLlm: () => null, getDefaultModel: () => null });
		await assert.rejects(() => assistant.chat({ message: "hi" }).then(() => broken.chat({ message: "hi" })), /模型|LLM|不可用/);
	} finally {
		await tmp.cleanup();
	}
});

export default runner.run;
