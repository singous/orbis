import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiBlobRequest, apiRequest } from "../../shared/api/api-client";
import { createManagedFiles, fileReference, uploadManagedFile } from "./managed-files";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
vi.mock("../../shared/api/api-client", async importOriginal => ({ ...await importOriginal<typeof import("../../shared/api/api-client")>(), apiBlobRequest: vi.fn(), apiRequest: vi.fn() }));
const wid = "00000000-0000-4000-8000-000000000001", asset = "00000000-0000-4000-8000-000000000002";
const auth: AuthRequestOptions = { accessToken: "access", refreshToken: null, workspaceId: wid, onTokenRefresh: vi.fn(), onUnauthorized: vi.fn() };
beforeEach(() => { vi.mocked(apiBlobRequest).mockReset(); vi.mocked(apiRequest).mockReset(); vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:private-owned-preview"); static revokeObjectURL = vi.fn(); }); });
afterEach(() => vi.unstubAllGlobals());
it("uploads a native workspace asset and returns an editor-local reference", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ id: asset, size_bytes: 5, sha256: "0".repeat(64) });
  expect(await uploadManagedFile(new File(["bytes"], "test.txt"), auth)).toBe(fileReference(asset));
  expect(apiRequest).toHaveBeenCalledWith(`/v1/workspaces/${wid}/assets`, expect.objectContaining({ method: "POST", body: expect.any(FormData), token: "access" }));
});
it("deduplicates private reads within one owner and revokes its object URL on disposal", async () => {
  vi.mocked(apiBlobRequest).mockResolvedValue(new Blob(["private"]));
  const files = createManagedFiles(() => auth);
  const [first, second] = await Promise.all([files.resolve(fileReference(asset)), files.resolve(fileReference(asset))]);
  expect(first).toBe(second);
  expect(apiBlobRequest).toHaveBeenCalledTimes(1);
  expect(apiBlobRequest).toHaveBeenCalledWith(`/v1/workspaces/${wid}/assets/${asset}/content`, expect.objectContaining({ token: "access", signal: expect.any(AbortSignal) }));
  files.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  await expect(files.resolve(fileReference(asset))).rejects.toMatchObject({ name: "AbortError" });
});
it("does not expose a delayed private preview after its session was replaced", async () => {
  let current: AuthRequestOptions | null = auth;
  let finish!: (value: Blob) => void;
  vi.mocked(apiBlobRequest).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const files = createManagedFiles(() => current);
  const result = files.resolve(fileReference(asset));
  current = null;
  finish(new Blob(["old session bytes"]));
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  files.dispose();
});
