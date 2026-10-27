import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "y-prosemirror";
import { boardNavigation } from "../../../boards/navigation";
import { showToast } from "../../../../shared/ui/Toast";

export const BOARD_REMOVAL_EVENT = "orbis-confirm-board-removal";
export type BoardRemovalRequest = { transaction: Transaction; blockIds: string[] };
const confirmed = new Set<string>();
const requested = new WeakSet<Transaction>();

function boardPaths(doc: PMNode, pending: Set<string>) {
  const present = new Map<string, string>();
  function visit(node: PMNode, path: string[]) {
    if (node.type.name === "orbisBoard" && pending.has(node.attrs.orbisId)) present.set(node.attrs.orbisId, JSON.stringify(path));
    const next = [...path, node.type.name, String(node.attrs.orbisId ?? ""), String(node.attrs.kind ?? "")];
    node.forEach(child => visit(child, next));
  }
  if (pending.size) visit(doc, []);
  return present;
}
function pendingBoards(doc: PMNode) { return boardPaths(doc, boardNavigation.pendingBlockIds()); }

/** 远端 Yjs 更新不能被本地 UI 拒绝；本地删除、剪切、粘贴覆盖需先确认。 */
export function allowBoardRemoval(editor: Editor, transaction: Transaction): boolean {
  if (!transaction.docChanged || transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) return true;
  const removed = pendingBoards(transaction.before);
  if (!removed.size) return true;
  const retained = boardPaths(transaction.doc, new Set(removed.keys()));
  for (const [id, path] of retained) if (removed.get(id) === path) removed.delete(id);
  if (![...removed.keys()].some(id => !confirmed.has(id))) return true;
  if (!requested.has(transaction)) {
    requested.add(transaction);
    queueMicrotask(() => {
      if (!editor.isDestroyed && editor.state.doc.eq(transaction.before)) editor.view.dom.dispatchEvent(new CustomEvent<BoardRemovalRequest>(BOARD_REMOVAL_EVENT, {
        detail: { transaction, blockIds: [...removed.keys()] },
      }));
    });
  }
  return false;
}

export function confirmBoardRemoval(editor: Editor, request: BoardRemovalRequest): boolean {
  // 确认期间正文可能收到协作更新，旧删除事务不能覆盖较新的内容。
  if (editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(request.transaction.before)) return false;
  for (const id of request.blockIds) confirmed.add(id);
  try {
    editor.view.dispatch(request.transaction);
    if (editor.state.doc.eq(request.transaction.before)) return false;
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    return true;
  } catch (error) {
    console.error("移除画板块失败", { stage: "confirmed-board-removal", block_ids: request.blockIds, error });
    return false;
  } finally { for (const id of request.blockIds) confirmed.delete(id); }
}

export function blockBoardHistory(editor: Editor): boolean {
  if (!pendingBoards(editor.state.doc).size) return false;
  showToast({ title: "画板尚未保存", description: "请先重试保存画板，再撤销或重做文档。", tone: "warning" });
  return true;
}
