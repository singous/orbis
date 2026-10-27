import { showToast, type ToastInput } from "../ui/Toast";

const handledErrors = new WeakSet<object>();
type OperationFeedback = {
  errors: Set<object>;
  lastError?: unknown;
  message?: string;
  unauthorized?: boolean;
};
export type RequestFeedback = {
  /** 默认提示失败；后台轮询、回执探测等内部请求可关闭提示。 */
  error?: boolean | ((error: unknown) => boolean);
  /** 需要成功提示的操作显式开启，使用后端返回的 message。 */
  success?: boolean;
  operation?: OperationFeedback;
};
export type FeedbackContext = { feedback?: RequestFeedback; canNotify?: () => boolean };
function shouldReport(feedback: RequestFeedback | undefined, error: unknown) {
  return typeof feedback?.error === "function" ? feedback.error(error) : feedback?.error !== false;
}

export function isRequestCancelled(error: unknown) {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}
export function markErrorHandled(error: unknown) {
  if (error && typeof error === "object") handledErrors.add(error);
}
function alreadyHandled(error: unknown): boolean {
  const seen = new Set<object>();
  while (error && typeof error === "object" && !seen.has(error)) {
    if (handledErrors.has(error)) return true;
    seen.add(error);
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}
/** 本地校验和非 HTTP 操作也通过同一入口报告；已处理的请求错误不会再弹一次。 */
export function reportError(error: unknown) {
  if (error === null || error === undefined || error === "") return;
  if (isRequestCancelled(error)) return;
  if (alreadyHandled(error)) return;
  const message = error instanceof Error && error.name === "ZodError" ? "服务返回的数据不完整，请刷新重试"
    : error instanceof Error ? error.message : typeof error === "string" ? error : "操作失败，请重试";
  showToast({ title: message || "请求失败", tone: "danger" });
}
export function reportRequestError(error: unknown) {
  reportError(error);
  markErrorHandled(error);
}
export function requestSucceeded(context: FeedbackContext, message: string) {
  const operation = context.feedback?.operation;
  if (operation) {
    operation.message = message;
    if (context.feedback?.error !== false) operation.lastError = undefined;
    return;
  }
  if (context.feedback?.success && context.canNotify?.() !== false) showToast({ title: message, tone: "success" });
}
export function requestFailed(context: FeedbackContext, error: unknown, allowed: boolean, unauthorized = false) {
  const operation = context.feedback?.operation;
  if (operation) {
    if (error && typeof error === "object") operation.errors.add(error);
    if (shouldReport(context.feedback, error) && allowed && !isRequestCancelled(error)) operation.lastError = error;
    operation.unauthorized ||= unauthorized && allowed;
    return;
  }
  if (shouldReport(context.feedback, error) && allowed) reportRequestError(error);
  else markErrorHandled(error);
}

/** 一次业务请求可能检查回执或重试；只报告最终结果，不把中间探测当成失败。 */
export async function withRequestFeedback<T, C extends FeedbackContext>(
  context: C,
  run: (context: C) => Promise<T>,
  resultFeedback?: (value: T, message: string) => ToastInput | null,
): Promise<T> {
  if (context.feedback?.operation) return run(context);
  const operation: OperationFeedback = { errors: new Set() };
  const scoped = { ...context, feedback: { ...context.feedback, operation } };
  try {
    const value = await run(scoped);
    if (context.feedback?.success && context.canNotify?.() !== false && operation.message) {
      const notice = resultFeedback ? resultFeedback(value, operation.message) : { title: operation.message, tone: "success" as const };
      if (notice) showToast(notice);
    }
    return value;
  } catch (error) {
    const handled = alreadyHandled(error);
    if (!handled && !isRequestCancelled(error) && shouldReport(context.feedback, error) && (context.canNotify?.() !== false || operation.unauthorized)) {
      reportRequestError(operation.lastError ?? error);
    }
    markErrorHandled(error);
    throw error;
  } finally {
    operation.errors.forEach(markErrorHandled);
  }
}
