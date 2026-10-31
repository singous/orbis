import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { parseFileReference, uploadManagedFile } from "../files/managed-files";
import { elementPatch, makeElement, type Command, type Element } from "./model";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_INSERT_EDGE = 640;
const MIN_INSERT_EDGE = 24;

/** 解码、上传与写入属于同一次画板页面会话，切页后不提交隐藏页面的图元。 */
export async function insertBoardImage(file: File, options: {
  auth: AuthRequestOptions;
  pageId: string;
  point: { x: number; y: number };
  replacing: Element | null;
  signal: AbortSignal;
  isCurrent: () => boolean;
  submit: (commands: Command[]) => Promise<void>;
}): Promise<string> {
  function assertCurrent() {
    if (options.signal.aborted || !options.isCurrent())
      throw new DOMException("画板页面或会话已切换，本次图片插入已停止，请在目标页面重新选择图片。", "AbortError");
  }
  assertCurrent();
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 20 MiB。");
  const bitmap = await createImageBitmap(file).catch((cause: unknown) => {
    throw new Error("图片无法解码，请选择有效的 PNG、JPEG、WebP 或 GIF 文件。", { cause });
  });
  const { width, height } = bitmap;
  bitmap.close();
  assertCurrent();
  if (width * height > MAX_IMAGE_PIXELS)
    throw new Error("图片分辨率过高，请缩小至 4000 万像素以内。");
  const reference = await uploadManagedFile(file, options.auth, options.signal);
  assertCurrent();
  const assetId = parseFileReference(reference);
  if (!assetId) throw new Error("图片上传回执无效。");
  const replacing = options.replacing;
  if (replacing) {
    await options.submit([{
      type: "elements.update",
      patches: [elementPatch(replacing, { structure: { ...replacing.structure, asset_id: assetId } })],
    }]);
    return replacing.id;
  }
  const element = makeElement("basic.image", options.pageId, options.point.x, options.point.y);
  const scale = Math.min(1, MAX_INSERT_EDGE / Math.max(width, height));
  element.text = "";
  element.structure.asset_id = assetId;
  element.geometry.width = Math.max(MIN_INSERT_EDGE, width * scale);
  element.geometry.height = Math.max(MIN_INSERT_EDGE, height * scale);
  await options.submit([{ type: "elements.create", elements: [element] }]);
  return element.id;
}
