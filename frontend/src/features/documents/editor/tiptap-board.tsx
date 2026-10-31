import { ySyncPluginKey } from "y-prosemirror";
import { Node } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";
import type { EditorView } from "@tiptap/pm/view";
import { blockSelectionKey } from "./blocks/block-selection";
import { allowBoardRemoval } from "./blocks/board-removal";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { lazy, Suspense, useContext } from "react";
import { EditorReadOnlyContext } from "./tiptap-editor-context";
import {
  clipboardPropsAttribute,
  parseClipboardProps,
} from "./tiptap-clipboard";
const BoardEmbed = lazy(() =>
  import("../../boards/BoardEmbed").then((m) => ({ default: m.BoardEmbed })),
);
function View({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  return (
    <NodeViewWrapper
      data-orbis-block-id={node.attrs.orbisId}
      contentEditable={false}
      data-orbis-embedded-editor
    >
      <Suspense fallback={<p>正在读取画板…</p>}>
        <BoardEmbed
          key={`${node.attrs.orbisProps?.board_id ?? ""}:${node.attrs.orbisProps?.page_id ?? ""}:${node.attrs.orbisProps?.revision ?? ""}:${node.attrs.orbisProps?.mode ?? ""}:${node.attrs.orbisProps?.frame_id ?? ""}`}
          blockId={String(node.attrs.orbisId)}
          props={node.attrs.orbisProps ?? {}}
          readOnly={readOnly}
          onBind={(binding) => {
            if (readOnly || editor.isDestroyed) return;
            const position = getPos();
            const current = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
            if (current?.type.name === "orbisBoard" && current.attrs.orbisId === node.attrs.orbisId) updateAttributes({ orbisProps: binding });
          }}
        />
      </Suspense>
    </NodeViewWrapper>
  );
}
const convertedBoardSelectionKey = new PluginKey<string | null>("orbis-converted-board-selection");
const hidden = { default: null, parseHTML: () => null, renderHTML: () => ({}) };
function typeAfterBoard(view: EditorView, text: string) {
  const { selection, schema } = view.state;
  const converted = convertedBoardSelectionKey.getState(view.state);
  const board = selection instanceof NodeSelection ? selection.node : selection instanceof GapCursor && converted && selection.$from.nodeAfter?.attrs.orbisId === converted ? selection.$from.nodeAfter : null;
  if (board?.type.name !== "orbisBoard") return false;
  const after = selection.from + board.nodeSize;
  const boundary = view.state.doc.resolve(after);
  const paragraph = schema.nodes.paragraph;
  if (!paragraph || !boundary.parent.canReplaceWith(boundary.index(), boundary.index(), paragraph)) return false;
  const tr = view.state.tr.insert(after, paragraph.create(null, text ? schema.text(text) : null));
  tr.setSelection(TextSelection.create(tr.doc, after + 1 + text.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}
export const OrbisBoard = Node.create({
  name: "orbisBoard",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin<string | null>({
      filterTransaction: transaction => allowBoardRemoval(editor, transaction),
      key: convertedBoardSelectionKey,
      state: {
        init: () => null,
        apply: (transaction, current) => {
          const converted = transaction.getMeta(convertedBoardSelectionKey) as string | null | undefined;
          if (converted !== undefined) return converted;
          if (transaction.selectionSet && !transaction.getMeta(ySyncPluginKey)?.isChangeOrigin) return null;
          const selected = transaction.getMeta(blockSelectionKey) as { ids: string[] } | undefined;
          return selected && current && !selected.ids.includes(current) ? null : current;
        },
      },
      // Yjs needs a boundary bookmark, while the block selection preserves
      // clipboard and deletion semantics for the explicitly selected board.
      appendTransaction: (transactions, oldState, state) => {
        if (ySyncPluginKey.getState(state) && state.selection instanceof NodeSelection && state.selection.node.type.name === "orbisBoard") {
          const id = String(state.selection.node.attrs.orbisId);
          return state.tr.setSelection(new GapCursor(state.selection.$from))
            .setMeta(convertedBoardSelectionKey, id)
            .setMeta(blockSelectionKey, { ids: [id], anchorId: id, focusId: id })
            .setMeta("addToHistory", false);
        }
        const previous = convertedBoardSelectionKey.getState(oldState);
        const selected = blockSelectionKey.getState(state)?.ids;
        // A real caret movement ends the converted selection. In particular,
        // an ordinary gap before another board must retain backward deletion.
        if (previous && !convertedBoardSelectionKey.getState(state) && selected?.length === 1 && selected[0] === previous && transactions.some(transaction => transaction.selectionSet && !transaction.getMeta(ySyncPluginKey)?.isChangeOrigin)) {
          return state.tr.setMeta(blockSelectionKey, { ids: [], anchorId: null, focusId: null }).setMeta("addToHistory", false);
        }
        return null;
      },
      props: {
        handleTextInput: (view, _from, _to, text) => typeAfterBoard(view, text),
        handleKeyDown: (view, event) => {
          if (!view.editable || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
          if ((event.key === "Delete" || event.key === "Backspace") && view.state.selection instanceof GapCursor && view.state.selection.$from.nodeAfter?.type.name === "orbisBoard" && convertedBoardSelectionKey.getState(view.state) && view.state.selection.$from.nodeAfter.attrs.orbisId === convertedBoardSelectionKey.getState(view.state)) {
            const from = view.state.selection.from;
            view.dispatch(view.state.tr.delete(from, from + view.state.selection.$from.nodeAfter.nodeSize));
            return true;
          }
          return (event.key === " " || event.key === "Enter") && typeAfterBoard(view, event.key === "Enter" ? "" : " ");
        },
      },
    })];
  },
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      orbisId: {
        ...hidden,
        renderHTML: (attributes) =>
          attributes.orbisId
            ? { "data-orbis-block-id": attributes.orbisId }
            : {},
      },
      orbisProps: hidden,
      orbisOriginal: hidden,
      orbisSignature: hidden,
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-orbis-board]",
        getAttrs: (element) => ({
          orbisProps: parseClipboardProps(element as HTMLElement),
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "figure",
      {
        "data-orbis-board": "true",
        ...clipboardPropsAttribute(node.attrs.orbisProps),
      },
      ["figcaption", {}, "画板"],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(View, { stopEvent: ({ event }) => event.target instanceof Element && !!event.target.closest("[data-orbis-embedded-editor]") });
  },
});
