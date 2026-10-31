import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { insertBoardImage } from "../../src/features/boards/image-import";
import { makeElement, type Command } from "../../src/features/boards/model";

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("../../src/features/files/managed-files", () => ({
  uploadManagedFile: mocks.upload,
  parseFileReference: (value: string) => value.startsWith("orbis-file:") ? value.slice(11) : null,
}));
const auth = { accessToken: "test", refreshToken: null, onTokenRefresh: () => {}, onUnauthorized: () => {} };
const file = new File(["image"], "image.png", { type: "image/png" });
function target() {
  return { auth, pageId: "page-A", point: { x: 20, y: 40 }, replacing: null,
    signal: new AbortController().signal, isCurrent: vi.fn(() => true), submit: vi.fn<(commands: Command[]) => Promise<void>>().mockResolvedValue(undefined) };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue("orbis-file:asset");
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1280, height: 640, close: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

it("does not upload or submit an image when its page changes while decoding", async () => {
  let release!: (bitmap: unknown) => void;
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise(resolve => { release = resolve; })));
  const options = target(), close = vi.fn();
  const importing = insertBoardImage(file, options);
  options.isCurrent.mockReturnValue(false);
  release({ width: 1280, height: 640, close });
  await expect(importing).rejects.toThrow("页面或会话已切换");
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(options.submit).not.toHaveBeenCalled();
});

it("does not write a hidden page when an upload ignores cancellation and resolves late", async () => {
  let release!: (reference: string) => void;
  mocks.upload.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const controller = new AbortController(), options = { ...target(), signal: controller.signal };
  const importing = insertBoardImage(file, options);
  await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
  expect(mocks.upload).toHaveBeenCalledWith(file, auth, controller.signal);
  controller.abort();
  release("orbis-file:asset");
  await expect(importing).rejects.toThrow("页面或会话已切换");
  expect(options.submit).not.toHaveBeenCalled();
});

it("keeps normal insertion dimensions and the original page", async () => {
  const options = target();
  const id = await insertBoardImage(file, options);
  const command = options.submit.mock.calls[0][0][0];
  expect(command.type).toBe("elements.create");
  if (command.type !== "elements.create") throw new Error("Expected insertion");
  expect(command.elements[0]).toMatchObject({ id, page_id: "page-A", structure: { asset_id: "asset" }, geometry: { x: 20, y: 40, width: 640, height: 320 } });
});

it("keeps replacement geometry and optimistic versions intact", async () => {
  const replacing = makeElement("basic.image", "page-A", 10, 30);
  replacing.versions.structure = 7;
  const options = { ...target(), replacing };
  expect(await insertBoardImage(file, options)).toBe(replacing.id);
  expect(options.submit).toHaveBeenCalledWith([{ type: "elements.update", patches: [{
    id: replacing.id, expected: replacing.versions, structure: { ...replacing.structure, asset_id: "asset" },
  }] }]);
});
