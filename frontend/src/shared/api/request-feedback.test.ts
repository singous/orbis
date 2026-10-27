import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, apiBlobRequest, apiRequest, publicMarkdownRequest } from "./api-client";
import { reportError, withRequestFeedback } from "./request-feedback";

const notify = vi.hoisted(() => vi.fn());
vi.mock("../ui/Toast", () => ({ showToast: notify }));
const response = (message: string, status = 200, data: unknown = { id: "result" }, code = status < 400 ? "OK" : "REJECTED") =>
  new Response(JSON.stringify({ code, message, data, request_id: "request-id" }), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => notify.mockClear());
afterEach(() => vi.unstubAllGlobals());

it("reports the backend message once while preserving the error contract", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("该名称已存在", 409, { version: 3 }, "VERSION_CONFLICT")));
  const error = await apiRequest("/v1/items", { method: "POST" }).catch(error => error);
  expect(error).toMatchObject({ status: 409, message: "该名称已存在", code: "VERSION_CONFLICT", requestId: "request-id", data: { version: 3 }, isConflict: true });
  reportError(error);
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "该名称已存在", tone: "danger" });
});

it("reports each new failed attempt even when the backend message is identical", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("保存失败", 422)));
  await apiRequest("/v1/items", { method: "PUT" }).catch(() => {});
  await apiRequest("/v1/items", { method: "PUT" }).catch(() => {});
  expect(notify).toHaveBeenCalledTimes(2);
});

it("keeps successful reads silent and opts into the backend success message", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("保存完成", 200, { id: "saved" })));
  expect(await apiRequest("/v1/items")).toEqual({ id: "saved" });
  expect(notify).not.toHaveBeenCalled();
  expect(await apiRequest("/v1/items", { method: "PUT", feedback: { success: true } })).toEqual({ id: "saved" });
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "保存完成", tone: "success" });
});

it("handles business errors and invalid responses through the same boundary", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("权限不足", 200, null, "FORBIDDEN")).mockResolvedValueOnce(new Response("not json")));
  await expect(apiRequest("/v1/items")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(apiRequest("/v1/items")).rejects.toMatchObject({ code: "API_RESPONSE_INVALID" });
  expect(notify.mock.calls.map(([input]) => input.title)).toEqual(["权限不足", "服务返回了无效响应，请重试"]);
});

it("uses a network fallback and never notifies cancelled requests", async () => {
  const cause = new TypeError("Failed to fetch");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(cause).mockRejectedValueOnce(new DOMException("cancelled", "AbortError")));
  await expect(apiRequest("/v1/items")).rejects.toMatchObject({ code: "NETWORK_ERROR", cause });
  await expect(apiRequest("/v1/items")).rejects.toMatchObject({ name: "AbortError" });
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "网络异常，请稍后重试", tone: "danger" });
});

it("does not report an intermediate 401 when credential refresh succeeds", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("登录过期", 401))
    .mockResolvedValueOnce(response("刷新成功", 200, { access_token: "new", refresh_token: "refresh-new" }))
    .mockResolvedValueOnce(response("读取成功")));
  await apiRequest("/v1/items", { token: "old", refreshToken: "feedback-refresh" });
  expect(notify).not.toHaveBeenCalled();
});

it("reports a final 401 once after applying the session-expiry callback", async () => {
  let current = true;
  const onUnauthorized = vi.fn(() => { current = false; });
  vi.stubGlobal("fetch", vi.fn(async () => response("请重新登录", 401)));
  await apiRequest("/v1/items", { canNotify: () => current, onUnauthorized }).catch(reportError);
  expect(onUnauthorized).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "请重新登录", tone: "danger" });
});

it("suppresses stale-session responses and explicitly silent probes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("旧工作空间错误", 403)));
  await apiRequest("/v1/items", { canNotify: () => false }).catch(reportError);
  await apiRequest("/v1/items", { feedback: { error: false } }).catch(reportError);
  expect(notify).not.toHaveBeenCalled();
});

it("reports one final backend error for a logical operation with retries", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("数据库暂不可用", 503)));
  const operation = withRequestFeedback({}, async context => {
    await apiRequest("/v1/items", context).catch(() => {});
    await apiRequest("/v1/items", context).catch(() => {});
    throw new ApiError(503, "本地包装的失败文案");
  });
  await operation.catch(reportError);
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "数据库暂不可用", tone: "danger" });
});

it("keeps a recovered attempt silent and emits only the opted-in successful response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("稍后重试", 503)).mockResolvedValueOnce(response("修改已保存")));
  await withRequestFeedback({ feedback: { success: true } }, async context => {
    await apiRequest("/v1/items", context).catch(() => {});
    return apiRequest("/v1/items", context);
  });
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "修改已保存", tone: "success" });
});

it("uses the same error handling for file downloads", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("文件不存在", 404)));
  await apiBlobRequest("/v1/assets/file").catch(reportError);
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "文件不存在", tone: "danger" });
});

it("does not duplicate a response error when a caller wraps its cause", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("不能保存", 409)));
  const cause = await apiRequest("/v1/items").catch(error => error);
  reportError(new Error("调用方补充的上下文", { cause }));
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "不能保存", tone: "danger" });
});

it("does not report an earlier failed attempt when the operation is cancelled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("暂时不可用", 503)));
  await withRequestFeedback({}, async context => {
    await apiRequest("/v1/items", context).catch(() => {});
    throw new DOMException("cancelled", "AbortError");
  }).catch(reportError);
  expect(notify).not.toHaveBeenCalled();
});

it("does not announce success before the operation validates its response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response("成功")));
  await withRequestFeedback({ feedback: { success: true } }, async context => {
    await apiRequest("/v1/items", context);
    throw new Error("响应内容不完整");
  }).catch(reportError);
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "响应内容不完整", tone: "danger" });
});

it("routes public Markdown responses through the same notification boundary", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("发布版本已更新", 409))
    .mockResolvedValueOnce(new Response("# 文档", { headers: { "Content-Type": "text/markdown" } })));
  await publicMarkdownRequest("/s/manual/pages/intro.md").catch(reportError);
  expect(await publicMarkdownRequest("/s/manual/pages/intro.md")).toBe("# 文档");
  expect(notify).toHaveBeenCalledExactlyOnceWith({ title: "发布版本已更新", tone: "danger" });
});
