import type { Editor } from "@tiptap/react";
import {
  Bold,
  Braces,
  ClipboardCopy,
  CodeXml,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Rows3,
  SeparatorHorizontal,
  Strikethrough,
  Table,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";

import { tiptapDocToMarkdown } from "./markdown-contract";
import type { TiptapDocument } from "./note-contract";

type EditorTool = {
  label: string;
  icon: LucideIcon;
  active?: (editor: Editor) => boolean;
  run: (editor: Editor) => boolean;
};

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function setLink(editor: Editor): boolean {
  const currentHref = editor.getAttributes("link").href as string | undefined;
  const nextHref = window.prompt("请输入链接地址", currentHref ?? "");
  if (nextHref === null) {
    return false;
  }

  const normalizedHref = normalizeUrl(nextHref);
  if (!normalizedHref) {
    return editor.chain().focus().unsetLink().run();
  }

  return editor.chain().focus().setLink({ href: normalizedHref }).run();
}

function copyMarkdown(editor: Editor): boolean {
  const markdown = tiptapDocToMarkdown(editor.getJSON() as TiptapDocument);
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(markdown).catch(() => {
      window.prompt("复制 Markdown", markdown);
    });
    return true;
  }

  window.prompt("复制 Markdown", markdown);
  return true;
}

const tools: EditorTool[] = [
  {
    label: "段落",
    icon: Type,
    active: (editor) => editor.isActive("paragraph"),
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    label: "加粗",
    icon: Bold,
    active: (editor) => editor.isActive("bold"),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    label: "斜体",
    icon: Italic,
    active: (editor) => editor.isActive("italic"),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    label: "删除线",
    icon: Strikethrough,
    active: (editor) => editor.isActive("strike"),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    label: "行内代码",
    icon: Braces,
    active: (editor) => editor.isActive("code"),
    run: (editor) => editor.chain().focus().toggleCode().run(),
  },
  {
    label: "链接",
    icon: LinkIcon,
    active: (editor) => editor.isActive("link"),
    run: setLink,
  },
  {
    label: "一级标题",
    icon: Heading1,
    active: (editor) => editor.isActive("heading", { level: 1 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "二级标题",
    icon: Heading2,
    active: (editor) => editor.isActive("heading", { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "三级标题",
    icon: Heading3,
    active: (editor) => editor.isActive("heading", { level: 3 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "无序列表",
    icon: List,
    active: (editor) => editor.isActive("bulletList"),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    label: "有序列表",
    icon: ListOrdered,
    active: (editor) => editor.isActive("orderedList"),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "任务列表",
    icon: ListTodo,
    active: (editor) => editor.isActive("taskList"),
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    label: "引用",
    icon: Quote,
    active: (editor) => editor.isActive("blockquote"),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "代码块",
    icon: CodeXml,
    active: (editor) => editor.isActive("codeBlock"),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: "分割线",
    icon: SeparatorHorizontal,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    label: "插入表格",
    icon: Table,
    active: (editor) => editor.isActive("table"),
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: "添加行",
    icon: Rows3,
    run: (editor) => editor.chain().focus().addRowAfter().run(),
  },
  {
    label: "添加列",
    icon: Columns3,
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
  },
  {
    label: "删除表格",
    icon: Trash2,
    run: (editor) => editor.chain().focus().deleteTable().run(),
  },
  {
    label: "复制 Markdown",
    icon: ClipboardCopy,
    run: copyMarkdown,
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
        const isActive = tool.active?.(editor) ?? false;
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
