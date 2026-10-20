export const MAX_BINARY_BYTES = 64 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 192 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 7 * 1024 * 1024;
export const MAX_BLOCKS = 10_000;
export const MAX_TARGETS = 2 * MAX_BLOCKS;
export const MAX_DEPTH = 32;
export const TRANSFORM_TIMEOUT_MS = 15_000;
export const MAX_WORKERS = 2;
export type ErrorCode = "EDIT_TARGET_REMOVED" | "INVALID_REQUEST" | "INVALID_STATE" | "INVALID_UPDATE" | "INVALID_CONTENT" | "CONTENT_TOO_LARGE" | "ENGINE_BUSY" | "ENGINE_TIMEOUT" | "ENGINE_FAILURE";
export class EngineError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
