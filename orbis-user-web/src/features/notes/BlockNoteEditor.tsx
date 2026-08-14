import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
// BlockNoteViewRaw renders the editor plus the default UI (side menu / slash
// menu / formatting toolbar) with BlockNote's own self-contained CSS, so the
// menus are properly positioned popovers. The shadcn variant relies on Tailwind
// utilities our v4 setup doesn't generate from node_modules (menus rendered
// unstyled), so we use the raw default UI instead.
import "@blocknote/react/style.css";
import { useEffect, useRef } from "react";

import { useThemeStore } from "../../shared/theme/theme-store";
import {
  extractPlainTextV2,
  type NoteBlocksV2,
  type OrbisBlock,
} from "./block-model";

export function BlockNoteEditor({
  blocks,
  onChange,
  readOnly = false,
}: {
  blocks: NoteBlocksV2;
  onChange: (next: { blocks: NoteBlocksV2; plainText: string }) => void;
  readOnly?: boolean;
}) {
  const theme = useThemeStore((state) => state.theme);
  // OrbisBlock mirrors BlockNote's Block shape; cast to avoid deep inline-style
  // generic friction (content is validated at the API boundary).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ initialContent: blocks.blocks as any });
  const lastEmitted = useRef<string>("");

  useEffect(() => {
    if (!editor) return;
    const incoming = JSON.stringify(blocks.blocks);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.replaceBlocks(editor.document, blocks.blocks as any);
  }, [blocks.blocks, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.isEditable = !readOnly;
  }, [editor, readOnly]);

  return (
    <BlockNoteViewRaw
      editor={editor}
      theme={theme === "dark" ? "dark" : "light"}
      onChange={() => {
        const doc = editor.document as unknown as OrbisBlock[];
        const next: NoteBlocksV2 = {
          schema_version: 2,
          editor: "blocknote",
          blocks: doc,
        };
        lastEmitted.current = JSON.stringify(doc);
        onChange({ blocks: next, plainText: extractPlainTextV2(doc) });
      }}
    />
  );
}
