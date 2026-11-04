import { StrictMode, useContext, type PropsWithChildren } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { clearToasts } from "../../shared/ui/Toast";
import { PublicShareFiles } from "../sharing/PublicShareFiles";
import { FileContentContext } from "./FileContent";
import { createManagedFiles, fileReference } from "./managed-files";

const workspace = "00000000-0000-4000-8000-000000000021";
const asset = "00000000-0000-4000-8000-000000000022";
const note = "00000000-0000-4000-8000-000000000023";
const token = "a".repeat(43);
const reference = fileReference(asset);
const auth: AuthRequestOptions = { accessToken: "private-access", refreshToken: null, workspaceId: workspace, onTokenRefresh() {}, onUnauthorized() {} };
function blobResponse() { return new Response("file bytes", { headers: { "Content-Type": "application/octet-stream" } }); }
function AnonymousFiles({ children }: PropsWithChildren) {
  return <StrictMode><PublicShareFiles token={token} noteId={note}>{children}</PublicShareFiles></StrictMode>;
}

beforeEach(() => {
  let nextURL = 0;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => `blob:owned-${++nextURL}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); clearToasts(); vi.unstubAllGlobals(); });

it("keeps private reference rules and authorizes before returning a cached object URL", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(blobResponse());
  vi.stubGlobal("fetch", fetchMock);
  let current: AuthRequestOptions | null = auth;
  const files = createManagedFiles(() => current);
  try {
    expect(await files.resolve("https://example.com/image.png")).toBe("https://example.com/image.png");
    await expect(files.resolve("orbis-file:invalid")).rejects.toThrow("文件标识无效");
    const urls = await Promise.all([files.resolve(reference), files.resolve(reference)]);
    expect(urls).toEqual(["blob:owned-1", "blob:owned-1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${workspace}/assets/${asset}/content`);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer private-access");
    current = null;
    await expect(files.resolve(reference)).rejects.toThrow("请先登录后读取文件");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { files.dispose(); }
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:owned-1");
  await expect(files.resolve("https://example.com/image.png")).rejects.toMatchObject({ name: "AbortError", message: "File session disposed" });
});

it("cancels private uploads and reads together without publishing a delayed object URL", async () => {
  const completions: Array<(response: Response) => void> = [];
  const fetchMock = vi.fn<typeof fetch>(() => new Promise(resolve => { completions.push(resolve); }));
  vi.stubGlobal("fetch", fetchMock);
  const files = createManagedFiles(() => auth);
  const upload = files.upload(new File(["new file"], "new.txt"));
  const read = files.resolve(reference);
  const results = Promise.allSettled([upload, read]);
  const uploadSignal = fetchMock.mock.calls[0][1]?.signal;
  expect(uploadSignal).toBeInstanceOf(AbortSignal);
  expect(fetchMock.mock.calls[1][1]?.signal).toBe(uploadSignal);
  files.dispose();
  expect(uploadSignal?.aborted).toBe(true);
  completions[0](new Response(JSON.stringify({ code: "OK", message: "", request_id: "upload-test", data: { id: asset, size_bytes: 8, sha256: "0".repeat(64) } }), { headers: { "Content-Type": "application/json" } }));
  completions[1](blobResponse());
  for (const result of await results) expect(result).toMatchObject({ status: "rejected", reason: { name: "AbortError" } });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("shares anonymous reads within StrictMode and disposes their URL and request scope on unmount", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(blobResponse());
  vi.stubGlobal("fetch", fetchMock);
  const view = renderHook(() => useContext(FileContentContext), { wrapper: AnonymousFiles });
  const files = view.result.current!;
  await expect(files.resolve("https://example.com/image.png")).rejects.toThrow("分享附件不可用");
  expect(await Promise.all([files.resolve(reference), files.resolve(reference)])).toEqual(["blob:owned-1", "blob:owned-1"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/public/shares/${token}/documents/${note}/assets/${asset}`);
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
  view.unmount();
  await waitFor(() => expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true));
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:owned-1");
  await expect(files.resolve(reference)).rejects.toThrow("分享附件不可用");
});

it("evicts a failed anonymous read so the same owner can retry", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(blobResponse());
  vi.stubGlobal("fetch", fetchMock);
  const view = renderHook(() => useContext(FileContentContext), { wrapper: AnonymousFiles });
  const files = view.result.current!;
  await expect(files.resolve(reference)).rejects.toBeInstanceOf(TypeError);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(await files.resolve(reference)).toBe("blob:owned-1");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  view.unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:owned-1"));
});

it("keeps object URLs isolated between anonymous share scopes", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => blobResponse());
  vi.stubGlobal("fetch", fetchMock);
  const first = renderHook(() => useContext(FileContentContext), { wrapper: AnonymousFiles });
  const second = renderHook(() => useContext(FileContentContext), { wrapper: ({ children }: PropsWithChildren) => <PublicShareFiles token={"b".repeat(43)} noteId={note}>{children}</PublicShareFiles> });
  expect(await Promise.all([first.result.current!.resolve(reference), second.result.current!.resolve(reference)])).toEqual(["blob:owned-1", "blob:owned-2"]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  first.unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:owned-1"));
  expect(await second.result.current!.resolve(reference)).toBe("blob:owned-2");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  second.unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-2"));
});

it("does not create an anonymous object URL when a delayed response completes after disposal", async () => {
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const view = renderHook(() => useContext(FileContentContext), { wrapper: AnonymousFiles });
  const pending = view.result.current!.resolve(reference);
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError", message: "Share reader disposed" });
  view.unmount();
  await waitFor(() => expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true));
  finish(blobResponse());
  await failure;
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
