/**
 * lib/errors.js — 工作台的稳定错误词汇。
 *
 * 所有可预期的失败都抛 WorkbenchError：code 是给程序（HTTP 状态映射 / 客户端判断）
 * 用的稳定标识，message 是给人和 agent 读的中文说明。HTTP 层与工具层只依赖这里。
 *
 * @module lib/errors
 */

/** 可预期的业务错误。 */
export class WorkbenchError extends Error {
	/**
	 * @param {string} code 稳定错误码，如 `not-found` / `project-archived`
	 * @param {string} message 可读错误信息
	 * @param {unknown} [detail] 可选的诊断细节（不会直接暴露给模型）
	 */
	constructor(code, message, detail) {
		super(message);
		this.name = "WorkbenchError";
		this.code = code;
		this.detail = detail;
	}
}

/** 快捷构造。 */
export function fail(code, message, detail) {
	return new WorkbenchError(code, message, detail);
}

/** 把任意异常折叠成 `{ code, message }`，保留 WorkbenchError 的语义。 */
export function toErrorInfo(error) {
	if (error instanceof WorkbenchError) return { code: error.code, message: error.message };
	const message = typeof error?.message === "string" && error.message.length > 0 ? error.message : String(error);
	return { code: "internal", message };
}

/** 错误码 → HTTP 状态码。 */
export function statusForCode(code) {
	switch (code) {
		case "bad-request":
		case "invalid-id":
		case "invalid-input":
		case "invalid-status":
		case "invalid-priority":
		case "invalid-due":
		case "duplicate-root":
			return 400;
		case "not-found":
			return 404;
		case "project-archived":
		case "project-not-empty":
		case "needs-you-derived":
		case "conflict":
		case "storage-unavailable":
		case "root-migration-failed":
		case "model-unavailable":
		case "speech-unavailable":
		case "speech-preparation-cancelled":
			return 409;
		case "forbidden":
			return 403;
		case "model-call-failed":
		case "speech-transcription-failed":
		case "speech-preparation-failed":
			return 502;
		case "speech-preparation-timeout":
			return 504;
		default:
			return 500;
	}
}
