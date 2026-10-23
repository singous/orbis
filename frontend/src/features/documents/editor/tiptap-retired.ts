import { Node, type Editor } from "@tiptap/core";
import { prepareBlockAction } from "./blocks/block-action-read";

// This persisted node name is only a deletion marker. It has no editor,
// renderer, clipboard importer, preview, or scene interpreter.
const hidden = { default: null, parseHTML: () => null, renderHTML: () => ({}) };
export const RetiredDrawing = Node.create({
  name: "orbisDrawing",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      orbisId: hidden,
      orbisProps: hidden,
      orbisOriginal: hidden,
      orbisSignature: hidden,
    };
  },
  renderHTML() {
    return ["span", { hidden: "", "data-orbis-retired": "drawing" }];
  },
});

/** Remove retired blocks through the current editor transaction, retaining all other Yjs identities. */
export function registerRetiredBlockCleanup(
  editor: Editor,
  onError: (message: string) => void,
): () => void {
  let cancelled = false;
  let running = false;
  let failed = false;
  const remove = async () => {
    if (
      cancelled ||
      running ||
      failed ||
      editor.isDestroyed ||
      !editor.isEditable
    )
      return;
    const ids = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name === "orbisDrawing") ids.add(node.attrs.orbisId);
    });
    if (!ids.size) return;
    running = true;
    let completed = false;
    try {
      await prepareBlockAction(editor, [...ids]);
      if (cancelled || editor.isDestroyed || !editor.isEditable) return;
      const ranges: Array<{ from: number; to: number }> = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "orbisDrawing" && ids.has(node.attrs.orbisId))
          ranges.push({ from: position, to: position + node.nodeSize });
      });
      const transaction = editor.state.tr.setMeta("addToHistory", false);
      for (const range of ranges.reverse())
        transaction.delete(range.from, range.to);
      if (transaction.docChanged) editor.view.dispatch(transaction);
      completed = true;
    } catch {
      failed = true;
      if (!cancelled && !editor.isDestroyed)
        onError("旧画板清理失败，请刷新后重试。");
    } finally {
      running = false;
      if (completed) void remove();
    }
  };
  const changed = () => {
    void remove();
  };
  editor.on("transaction", changed);
  changed();
  return () => {
    cancelled = true;
    editor.off("transaction", changed);
  };
}
