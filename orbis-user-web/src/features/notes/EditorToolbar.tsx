import type { Editor } from "@tiptap/react";
import { Bold, Code, Heading2, Italic, List, ListOrdered, Quote } from "lucide-react";

const tools = [
  {
    label: "加粗",
    icon: Bold,
    active: (editor: Editor) => editor.isActive("bold"),
    run: (editor: Editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    label: "斜体",
    icon: Italic,
    active: (editor: Editor) => editor.isActive("italic"),
    run: (editor: Editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    label: "二级标题",
    icon: Heading2,
    active: (editor: Editor) => editor.isActive("heading", { level: 2 }),
    run: (editor: Editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "无序列表",
    icon: List,
    active: (editor: Editor) => editor.isActive("bulletList"),
    run: (editor: Editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    label: "有序列表",
    icon: ListOrdered,
    active: (editor: Editor) => editor.isActive("orderedList"),
    run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "引用",
    icon: Quote,
    active: (editor: Editor) => editor.isActive("blockquote"),
    run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "代码块",
    icon: Code,
    active: (editor: Editor) => editor.isActive("codeBlock"),
    run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
];

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] px-4 py-2">
      {tools.map((tool) => {
        const Icon = tool.icon;
        const isActive = tool.active(editor);
        return (
          <button
            key={tool.label}
            type="button"
            aria-label={tool.label}
            title={tool.label}
            onClick={() => tool.run(editor)}
            className={[
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] transition",
              "hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
              isActive ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "",
            ].join(" ")}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
