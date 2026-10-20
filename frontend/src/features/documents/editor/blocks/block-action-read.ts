import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { BlockLoadState } from "../content-window";

type BlockActionReader = {
  needsRead: (ids: string[]) => boolean;
  ensure: (ids: string[]) => Promise<void>;
};
type RegisteredReader = BlockActionReader & { authoredVersion: number };
const readers = new WeakMap<Editor, RegisteredReader>();

/** Read completeness is editor-session state, never an authored block prop. */
export function selectedBlocksNeedRead(editor: Editor, ids: string[], states: ReadonlyMap<string, BlockLoadState>): boolean {
  if (!states.size) return false;
  const wanted = new Set(ids);
  let pending = false;
  const check = (id: unknown) => {
    const state = typeof id === "string" ? states.get(id) : undefined;
    if (state && (!state.payload_loaded || !state.children_loaded)) pending = true;
  };
  editor.state.doc.descendants(node => {
    if (!wanted.has(node.attrs.orbisId as string)) return;
    check(node.attrs.orbisId);
    node.descendants(child => { check(child.attrs.orbisId); });
    return false;
  });
  return pending;
}

export function registerBlockActionReader(editor: Editor, reader: BlockActionReader): () => void {
  const entry = { ...reader, authoredVersion: 0 };
  readers.set(editor, entry);
  const track = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged && !transaction.getMeta("orbis-content-page")) entry.authoredVersion += 1;
  };
  editor.on("transaction", track);
  return () => { editor.off("transaction", track); if (readers.get(editor) === entry) readers.delete(editor); };
}

export function blockActionNeedsRead(editor: Editor, ids: string[]): boolean {
  return readers.get(editor)?.needsRead(ids) ?? false;
}

/** A delayed browser write must not retry through another document's session. */
export function captureBlockActionSession(editor: Editor): () => boolean {
  const entry = readers.get(editor);
  const version = entry?.authoredVersion;
  return () => !editor.isDestroyed && readers.get(editor) === entry && entry?.authoredVersion === version;
}

/** Capture IDs before awaiting; reject edited, switched, missing or partial data. */
export async function prepareBlockAction(editor: Editor, ids: string[]): Promise<void> {
  const entry = readers.get(editor);
  if (!entry?.needsRead(ids)) return;
  const version = entry.authoredVersion;
  await entry.ensure([...ids]);
  if (editor.isDestroyed || readers.get(editor) !== entry) throw new Error("文档已切换，操作已取消，原内容已保留。");
  if (entry.authoredVersion !== version) throw new Error("读取期间正文已变化，请重新选择后操作，原内容已保留。");
  const present = new Set<string>();
  editor.state.doc.descendants(node => { if (typeof node.attrs.orbisId === "string") present.add(node.attrs.orbisId); });
  if (ids.some(id => !present.has(id))) throw new Error("目标块已变化，操作已取消，原内容已保留。");
  if (entry.needsRead(ids)) throw new Error("子内容尚未完整载入，操作已取消，原内容已保留。");
}
