import { Node } from "@tiptap/core";
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
function View({ node, updateAttributes }: NodeViewProps) {
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
          onBind={(binding) => updateAttributes({ orbisProps: binding })}
        />
      </Suspense>
    </NodeViewWrapper>
  );
}
const hidden = { default: null, parseHTML: () => null, renderHTML: () => ({}) };
export const OrbisBoard = Node.create({
  name: "orbisBoard",
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
    return ReactNodeViewRenderer(View);
  },
});
