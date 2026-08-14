import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
// @blocknote/react 0.53 ships no default UI components by itself (its
// ComponentsContext defaults to undefined), so a bare BlockNoteViewRaw renders
// no slash menu / formatting toolbar / side menu at all. The mantine adapter
// provides the full default UI, and its styles are driven by --bn-* CSS
// variables. The `orbis-bn` className lands on both the editor container and
// every popup portal root, so the Notion/Yuque-style skin in styles/index.css
// (`.orbis-bn …`) can theme the editor canvas and all menus.
import "@blocknote/react/style.css";
import "@blocknote/mantine/style.css";
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
  const editor = useCreateBlockNote({ dictionary: zh, initialContent: blocks.blocks as any });
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
    <BlockNoteView
      editor={editor}
      className="orbis-bn"
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
