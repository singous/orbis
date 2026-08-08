import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

import type { NoteBlocks } from "../../shared/api/schemas";
import { extractPlainText, toNoteBlocks, type TiptapDocument } from "./note-contract";
import { EditorToolbar } from "./EditorToolbar";
import { looksLikeMarkdown, markdownToTiptapDoc } from "./markdown-contract";

export function TiptapNoteEditor({
  blocks,
  onChange,
  readOnly = false,
}: {
  blocks: NoteBlocks;
  onChange: (next: { blocks: NoteBlocks; plainText: string }) => void;
  readOnly?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({
        placeholder: "开始记录。先把想法留住，再慢慢整理。",
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({
        HTMLAttributes: {
          "data-type": "taskItem",
        },
        nested: true,
        a11y: {
          checkboxLabel: (node) => `${node.attrs.checked ? "已完成" : "未完成"}任务：${node.textContent || "空任务"}`,
        },
      }),
    ],
    content: blocks.doc as JSONContent,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral max-w-none min-h-[420px] px-6 py-5 text-[15px] leading-7 text-[var(--text)] focus:outline-none",
      },
      handlePaste: (view, event) => {
        const clipboardData = event.clipboardData;
        const markdown = clipboardData?.getData("text/plain") ?? "";
        const html = clipboardData?.getData("text/html") ?? "";
        if (!markdown || html || !looksLikeMarkdown(markdown)) {
          return false;
        }

        const doc = view.state.schema.nodeFromJSON(markdownToTiptapDoc(markdown));
        view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
        event.preventDefault();
        return true;
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

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <section className="overflow-hidden rounded-md border border-[var(--border)] bg-white shadow-sm">
      {!readOnly ? <EditorToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </section>
  );
}
