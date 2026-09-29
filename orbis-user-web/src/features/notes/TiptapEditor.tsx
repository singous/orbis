import { ActionButton } from "../../shared/ui/ActionButton";
import { Input as HeroInput } from "@heroui/react/input";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Bold, Code, Heading1, Heading2, Heading3, Image, Italic, Link2, List, ListChecks, ListOrdered, Minus, Paperclip, Plus, Quote, Redo2, Strikethrough, Table2, Underline, Undo2 } from "../../shared/ui/icons";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { safeContentUrl } from "../content/ContentRenderer";
import { DOCUMENT_BLOCKS, type DocumentBlockKind } from "../content/document-components";
import { FileContentContext } from "../files/FileContent";
import { useManagedFiles } from "../files/use-managed-files";
import { parseFileReference } from "../files/managed-files";
import { canonicalJSON, extractPlainTextV2, newBlockId, type NoteBlocksV2, type OrbisBlock } from "./block-model";
import { createDocumentBlock, INSERTABLE_DOCUMENT_BLOCKS } from "./tiptap-insert";
import { tiptapExtensions } from "./tiptap-extensions";
import { EditorReadOnlyContext } from "./tiptap-editor-context";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import "../../styles/tiptap-editor.css";

type EditorChange = { blocks: NoteBlocksV2; plainText: string };
type Command = { label: string; keywords: string; icon: ReactNode; run: (editor: Editor) => void };

function insertBlock(editor: Editor, value: OrbisBlock) {
  const node = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [value] }).content?.[0];
  if (node) editor.chain().focus().insertContent(node).run();
}

const COMMANDS: Command[] = [
  { label: "段落", keywords: "paragraph text", icon: <Plus size={16} />, run: (editor) => editor.chain().focus().setParagraph().run() },
  ...([1, 2, 3] as const).map((level) => ({ label: `${level} 级标题`, keywords: `heading h${level} 标题`, icon: level === 1 ? <Heading1 size={16} /> : level === 2 ? <Heading2 size={16} /> : <Heading3 size={16} />, run: (editor: Editor) => editor.chain().focus().toggleHeading({ level }).run() })),
  { label: "无序列表", keywords: "bullet list", icon: <List size={16} />, run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "有序列表", keywords: "numbered ordered list", icon: <ListOrdered size={16} />, run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { label: "任务清单", keywords: "task checklist", icon: <ListChecks size={16} />, run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { label: "引用", keywords: "quote", icon: <Quote size={16} />, run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { label: "代码块", keywords: "code", icon: <Code size={16} />, run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { label: "分隔线", keywords: "divider rule", icon: <Minus size={16} />, run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { label: "表格", keywords: "table", icon: <Table2 size={16} />, run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ...INSERTABLE_DOCUMENT_BLOCKS.map((kind: DocumentBlockKind) => ({ label: DOCUMENT_BLOCKS[kind].label, keywords: `${kind} document`, icon: <Plus size={16} />, run: (editor: Editor) => insertBlock(editor, createDocumentBlock(kind)) })),
];

function Tool({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <ActionButton type="button" title={title} aria-label={title} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</ActionButton>;
}

function inlineLink(editor: Editor) {
  const previous = editor.getAttributes("link").href as string | undefined;
  const href = window.prompt("链接地址", previous ?? "https://");
  if (href === null) return;
  if (!href.trim()) { editor.chain().focus().unsetLink().run(); return; }
  const internalDocument = /^\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:#[a-zA-Z0-9_-]+)?$/.test(href);
  if (!safeContentUrl(href) && !internalDocument && !parseFileReference(href)) { window.alert("请输入有效的 http(s)、mailto、站内文档或锚点链接。"); return; }
  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function slashQuery(editor: Editor): { query: string; from: number; to: number } | null {
  const { $from, empty } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  const match = /^\/([^\s/]*)$/.exec(before);
  return match ? { query: match[1].toLocaleLowerCase(), from: $from.pos - before.length, to: $from.pos } : null;
}

export function TiptapEditor({ blocks, onChange, onError, readOnly = false }: {
  blocks: NoteBlocksV2;
  onChange: (next: EditorChange) => void;
  onError?: (message: string | null) => void;
  readOnly?: boolean;
}) {
  const files = useManagedFiles();
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const errorCallback = useRef(onError);
  errorCallback.current = onError;
  const lastEmitted = useRef<NoteBlocksV2 | null>(null);
  // useEditor consumes content only when creating the instance. Do not rebuild
  // the whole document when selection, toolbar, or parent state changes.
  const [initialContent] = useState(() => toTiptapDocument(blocks));
  const lastApplied = useRef(blocks);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCommand, setActiveCommand] = useState(0);
  const [slash, setSlash] = useState<{ query: string; from: number; to: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  onChangeRef.current = onChange;
  readOnlyRef.current = readOnly;

  function emitChange(current: Editor) {
    if (readOnlyRef.current) return;
    try {
      const next = fromTiptapDocument(current.state.doc);
      lastEmitted.current = next;
      onChangeRef.current({ blocks: next, plainText: extractPlainTextV2(next.blocks) });
      setContentError(null);
      errorCallback.current?.(null);
    } catch {
      const message = "正文暂未保存：内容转换失败。当前编辑仍保留，请重试保存。";
      setContentError(message);
      errorCallback.current?.(message);
    }
  }

  const editor = useEditor({
    extensions: tiptapExtensions,
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    onCreate: ({ editor: current }) => {
      // Warm immutable block conversions while opening, before the first key.
      fromTiptapDocument(current.state.doc);
    },
    onUpdate: ({ editor: current }) => {
      emitChange(current);
      setSlash(slashQuery(current));
    },
    onSelectionUpdate: ({ editor: current }) => { setSlash(slashQuery(current)); },
  });

  const active = useEditorState({ editor, selector: ({ editor: current }) => ({
    bold: current?.isActive("bold"), italic: current?.isActive("italic"),
    underline: current?.isActive("underline"), strike: current?.isActive("strike"),
    link: current?.isActive("link"),
    h1: current?.isActive("heading", { level: 1 }),
    h2: current?.isActive("heading", { level: 2 }),
    h3: current?.isActive("heading", { level: 3 }),
    bulletList: current?.isActive("bulletList"), orderedList: current?.isActive("orderedList"),
    taskList: current?.isActive("taskList"),
  }) });

  useEffect(() => {
    if (!editor) return;
    if (blocks === lastApplied.current) return;
    lastApplied.current = blocks;
    if (blocks === lastEmitted.current) return;
    const current = fromTiptapDocument(editor.state.doc);
    if (canonicalJSON(blocks) === canonicalJSON(current)) return;
    editor.commands.setContent(toTiptapDocument(blocks), false);
    lastEmitted.current = null;
  }, [blocks, editor]);

  // Apply a restored/server revision before changing editability. setEditable
  // dispatches a transaction; doing it first could emit the stale live draft
  // during the same render and overwrite the restored revision.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !editor) return;
    setUploadError(null);
    try {
      const url = await files.upload(file);
      if (editor.isDestroyed || readOnlyRef.current) return;
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "file";
      insertBlock(editor, { id: newBlockId(), type: kind, props: { url, name: file.name, caption: file.name }, content: [], children: [] });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "文件上传失败");
    }
  }

  function run(command: Command) {
    if (!editor) return;
    if (slash) editor.chain().deleteRange({ from: slash.from, to: slash.to }).run();
    command.run(editor);
    setSlash(null); setMenuOpen(false);
  }

  const visible = slash ? COMMANDS.filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(slash.query)) : COMMANDS;
  return <EditorReadOnlyContext.Provider value={readOnly}><FileContentContext.Provider value={files}><div className="orbis-tiptap document-prose" data-testid="orbis-tiptap-editor" onKeyDownCapture={(event) => {
    if (readOnly || (!menuOpen && !slash)) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); setSlash(null); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      setActiveCommand((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % Math.max(visible.length, 1));
    } else if (event.key === "Enter" && visible.length) { event.preventDefault(); event.stopPropagation(); run(visible[activeCommand % visible.length]); }
  }}>
    {!readOnly && editor ? <div className="orbis-tiptap-toolbar" role="toolbar" aria-label="文档格式">
      <Tool title="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></Tool>
      <Tool title="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></Tool>
      <span className="orbis-tiptap-toolbar-divider" />
      <Tool title="粗体" active={active?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></Tool>
      <Tool title="斜体" active={active?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></Tool>
      <Tool title="下划线" active={active?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={16} /></Tool>
      <Tool title="删除线" active={active?.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></Tool>
      <Tool title="链接" active={active?.link} onClick={() => inlineLink(editor)}><Link2 size={16} /></Tool>
      <span className="orbis-tiptap-toolbar-divider" />
      <Tool title="标题 1" active={active?.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Tool>
      <Tool title="标题 2" active={active?.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Tool>
      <Tool title="标题 3" active={active?.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></Tool>
      <Tool title="无序列表" active={active?.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></Tool>
      <Tool title="有序列表" active={active?.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></Tool>
      <Tool title="任务清单" active={active?.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={16} /></Tool>
      <Tool title="表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></Tool>
      <Tool title="上传媒体或附件" onClick={() => inputRef.current?.click()}><Image size={16} /><Paperclip size={13} /></Tool>
      <ActionButton type="button" className="orbis-tiptap-insert" aria-label="插入内容" aria-expanded={menuOpen} onClick={() => { setActiveCommand(0); setMenuOpen((value) => !value); }}><Plus size={15} />插入</ActionButton>
      <input ref={inputRef} type="file" aria-label="选择上传文件" hidden onChange={(event) => void upload(event)} />
    </div> : null}
    {uploadError ? <p role="alert" className="orbis-tiptap-error">{uploadError}</p> : null}
    {contentError ? <div role="alert" className="orbis-tiptap-error"><p>{contentError}</p><ActionButton type="button" disabled={readOnly} onClick={() => editor && emitChange(editor)}>重试保存正文</ActionButton></div> : null}
    {!readOnly && editor && (slash || menuOpen) ? <div className="orbis-tiptap-menu" role="listbox" aria-label="插入内容">{visible.length ? visible.map((item, index) => <ActionButton type="button" role="option" aria-selected={index === activeCommand % visible.length} key={item.label} onMouseDown={(event) => event.preventDefault()} onClick={() => run(item)}>{item.icon}{item.label}</ActionButton>) : <p>没有匹配的内容块</p>}</div> : null}
    <EditorContent editor={editor} aria-label="文档正文" />
  </div></FileContentContext.Provider></EditorReadOnlyContext.Provider>;
}
