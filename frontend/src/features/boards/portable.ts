import { newUUID } from "../../shared/ids";
import { z } from "zod";
import { apiBlobRequest, workspacePath } from "../../shared/api/api-client";
import {
  authRequestOptions,
  type AuthRequestOptions,
} from "../../shared/auth/use-auth-request";
import { uploadManagedFile, parseFileReference } from "../files/managed-files";
import {
  boardSchema,
  elementSchema,
  pageSchema,
  type Board,
  type Command,
  type Element,
} from "./model";
import { cloneElements } from "./templates";

export const MAX_PORTABLE_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const mediaType = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const assetSchema = z
  .object({
    id: z.string().uuid(),
    media_type: mediaType,
    data: z.string().max(MAX_ASSET_BYTES * 2),
  })
  .strict();
export const portableSchema = z
  .object({
    format: z.literal("orbis.board"),
    schema_version: z.literal(1),
    board: boardSchema,
    elements: elementSchema.array().max(50_000),
    assets: assetSchema.array().max(500),
  })
  .strict();
export type PortableBoard = z.infer<typeof portableSchema>;

export function parsePortable(raw: string): PortableBoard {
  if (new TextEncoder().encode(raw).length > MAX_PORTABLE_BYTES)
    throw new Error("文件超过 32 MiB 导入限制。");
  const file = portableSchema.parse(JSON.parse(raw));
  if (file.board.pages.length + file.elements.length > 500)
    throw new Error(
      "单次导入最多 500 个页面与对象；文件未导入，请按页面拆分。",
    );
  const pages = new Set(file.board.pages.map((p) => p.id));
  const elements = new Map(file.elements.map((e) => [e.id, e]));
  const assets = new Set(file.assets.map((a) => a.id));
  if (
    pages.size !== file.board.pages.length ||
    elements.size !== file.elements.length ||
    assets.size !== file.assets.length
  )
    throw new Error("文件含重复标识。");
  for (const e of file.elements) {
    if (!pages.has(e.page_id)) throw new Error("对象引用了不存在的页面。");
    for (const id of [
      e.structure.parent_id,
      e.structure.start?.element_id,
      e.structure.end?.element_id,
    ]) {
      if (id && elements.get(id)?.page_id !== e.page_id)
        throw new Error("对象引用不完整或跨越页面。");
    }
    if (e.structure.asset_id && !assets.has(e.structure.asset_id))
      throw new Error("文件缺少图片资源，请重新导出包含图片的文件。");
  }
  return file;
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

/** Each export owns a bounded cache; assets are fetched sequentially within a byte budget. */
export function exportAssets(auth: AuthRequestOptions, signal?: AbortSignal) {
  let bytes = 0;
  const cache = new Map<string, Promise<z.infer<typeof assetSchema>>>();
  const load = (id: string) => {
    if (!cache.has(id))
      cache.set(
        id,
        (async () => {
          const blob = await apiBlobRequest(
            workspacePath(auth, "/assets/" + id + "/content"),
            { ...authRequestOptions(auth), signal },
          );
          const type = mediaType.parse(blob.type.split(";")[0]);
          bytes += blob.size;
          if (bytes > MAX_ASSET_BYTES)
            throw new Error("图片总量超过 16 MiB 导出预算，请缩小导出范围。");
          return { id, media_type: type, data: await blobBase64(blob) };
        })(),
      );
    return cache.get(id)!;
  };
  return {
    load,
    url: async (id: string) => {
      const a = await load(id);
      return "data:" + a.media_type + ";base64," + a.data;
    },
  };
}

export async function portableFile(
  board: Board,
  elements: Element[],
  auth: AuthRequestOptions,
  signal?: AbortSignal,
): Promise<Blob> {
  const loader = exportAssets(auth, signal);
  const assets: z.infer<typeof assetSchema>[] = [];
  const ids = new Set(
    elements.flatMap((e) =>
      e.structure.asset_id ? [e.structure.asset_id] : [],
    ),
  );
  for (const id of ids) assets.push(await loader.load(id));
  const blob = new Blob(
    [
      JSON.stringify({
        format: "orbis.board",
        schema_version: 1,
        board,
        elements,
        assets,
      }),
    ],
    { type: "application/json" },
  );
  if (blob.size > MAX_PORTABLE_BYTES)
    throw new Error("文件超过 32 MiB 导出预算。");
  return blob;
}

export async function importCommands(
  file: PortableBoard,
  existingPages: number,
  auth: AuthRequestOptions,
): Promise<Command[]> {
  if (existingPages + file.board.pages.length > 20)
    throw new Error("导入后超过 20 页上限，请创建新画板后导入。");
  // Validate all bytes before uploading anything. The board itself is written once, atomically.
  let bytes = 0;
  const images = file.assets.map((a) => {
    const data = atob(a.data);
    bytes += data.length;
    if (bytes > MAX_ASSET_BYTES)
      throw new Error("图片总量超过 16 MiB 导入预算。");
    return {
      id: a.id,
      file: new File(
        [Uint8Array.from(data, (c) => c.charCodeAt(0))],
        "board-image." + a.media_type.split("/")[1],
        { type: a.media_type },
      ),
    };
  });
  const assets = new Map<string, string>();
  for (const image of images) {
    const id = parseFileReference(await uploadManagedFile(image.file, auth));
    if (!id) throw new Error("图片上传回执无效。");
    assets.set(image.id, id);
  }
  const commands: Command[] = [];
  for (const [index, original] of file.board.pages.entries()) {
    const page = pageSchema.parse({
      ...original,
      id: newUUID(),
      version: 0,
      position: existingPages + index,
    });
    commands.push({ type: "pages.create", page });
    const elements = cloneElements(
      file.elements.filter((e) => e.page_id === original.id),
      page.id,
      0,
      0,
    );
    for (const e of elements)
      if (e.structure.asset_id)
        e.structure.asset_id = assets.get(e.structure.asset_id)!;
    if (elements.length) commands.push({ type: "elements.create", elements });
  }
  return commands;
}
