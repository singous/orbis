import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

import type { NoteBlocks } from "../../shared/api/schemas";
import { extractPlainText, toNoteBlocks, type TiptapDocument } from "./note-contract";
import { EditorToolbar } from "./EditorToolbar";

export function TiptapNoteEditor({
  blocks,
  onChange,
}: {
  blocks: NoteBlocks;
  onChange: (next: { blocks: NoteBlocks; plainText: string }) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "开始记录。先把想法留住，再慢慢整理。",
      }),
    ],
    content: blocks.doc as JSONContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral max-w-none min-h-[420px] px-6 py-5 text-[15px] leading-7 text-[var(--text)] focus:outline-none",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const doc = activeEditor.getJSON() as TiptapDocument;
      onChange({
        blocks: toNoteBlocks(doc),
        plainText: extractPlainText(doc),
      });
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(blocks.doc);
    if (current !== next) {
      editor.commands.setContent(blocks.doc as JSONContent, false);
    }
  }, [blocks.doc, editor]);

  return (
    <section className="overflow-hidden rounded-md border border-[var(--border)] bg-white shadow-sm">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </section>
  );
}
