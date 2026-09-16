import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createManagedFiles, fileReference, parseFileReference, uploadManagedFile } from "../../src/features/files/managed-files";

const fileId = "0190a111-1111-7111-8111-111111111111";
const auth = { accessToken: "access-token", refreshToken: "refresh-token", onTokenRefresh: vi.fn(), onUnauthorized: vi.fn() };
const envelope = (data: unknown, status = 200, code = "OK") => new Response(JSON.stringify({ code, message: "message", request_id: "request", data }), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  // jsdom provides URL parsing but not browser object URL lifetime APIs.
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn();
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("uploads a real multipart body and returns only a stable internal reference", async () => {
  const fetcher = vi.fn().mockResolvedValue(envelope({ id: fileId, upload_status: "completed" }, 201));
  vi.stubGlobal("fetch", fetcher);
  const file = new File(["image"], "image.png", { type: "image/png" });
  expect(await uploadManagedFile(file, auth)).toBe(`orbis-file:${fileId}`);
  expect(fetcher).toHaveBeenCalledWith("/api/files", expect.objectContaining({ headers: { Authorization: "Bearer access-token" }, method: "POST" }));
  expect(fetcher.mock.calls[0][1].body.get("file")).toBe(file);
});

it("strictly recognizes canonical file references", () => {
  expect(parseFileReference(fileReference(fileId))).toBe(fileId);
  for (const value of [`orbis-file:${fileId}?token=secret`, `orbis-file:${fileId.toUpperCase()}`, `orbis-file:../${fileId}`, "https://example.com/file.png"]) {
    expect(parseFileReference(value)).toBeNull();
  }
});

it("reads authenticated binary bytes, refreshes once and shares one object URL per file", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(envelope(null, 401, "AUTH_REQUIRED"))
    .mockResolvedValueOnce(envelope({ access_token: "fresh-token" }))
    .mockResolvedValueOnce(new Response("real-binary", { headers: { "Content-Type": "image/png" } }));
  vi.stubGlobal("fetch", fetcher);
  const objectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-image");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const files = createManagedFiles(() => auth);
  expect(await Promise.all([files.resolve(fileReference(fileId)), files.resolve(fileReference(fileId))])).toEqual(["blob:test-image", "blob:test-image"]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher).toHaveBeenLastCalledWith(`/api/files/${fileId}/content`, expect.objectContaining({ headers: { Authorization: "Bearer fresh-token" } }));
  expect(auth.onTokenRefresh).toHaveBeenCalledWith("fresh-token");
  expect(objectUrl).toHaveBeenCalledTimes(1);
  const bytes = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(objectUrl.mock.calls[0][0] as Blob);
  });
  expect(bytes).toBe("real-binary");
  files.dispose();
  expect(revoke).toHaveBeenCalledWith("blob:test-image");
});

it("keeps external media URLs unchanged and sends credentials only to the file API", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const files = createManagedFiles(() => auth);
  expect(await files.resolve("https://example.com/photo.png")).toBe("https://example.com/photo.png");
  await expect(files.resolve("orbis-file:invalid")).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  files.dispose();
});

it("does not expose a late response after the editor or login session is disposed", async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; })));
  const objectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
  const files = createManagedFiles(() => auth);
  const result = files.resolve(fileReference(fileId));
  files.dispose();
  complete(new Response("private", { headers: { "Content-Type": "image/png" } }));
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(objectUrl).not.toHaveBeenCalled();
});

it("reports a JSON error for a missing file and permits an explicit retry", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(envelope(null, 404, "FILE_NOT_FOUND"))
    .mockResolvedValueOnce(new Response("retry", { headers: { "Content-Type": "application/octet-stream" } }));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const files = createManagedFiles(() => auth);
  await expect(files.resolve(fileReference(fileId))).rejects.toMatchObject({ code: "FILE_NOT_FOUND", status: 404 });
  expect(await files.resolve(fileReference(fileId))).toBe("blob:retry");
  files.dispose();
});
