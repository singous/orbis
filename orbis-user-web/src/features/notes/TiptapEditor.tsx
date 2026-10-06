import { ActionButton } from "../../shared/ui/ActionButton";
import { SelectField } from "../../shared/ui/SelectField";
import { createPortal } from "react-dom";
import { useEditorToolbarHost } from "../documents/EditorToolbarHost";
import { BlockControls, requestBlockMenu } from "./blocks/BlockControls";
import { OrbisBlockSelection, blockSelectionKey, setBlockSelection } from "./blocks/block-selection";
import { executeBlockCommand, locateEditorBlocks } from "./blocks/block-commands";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Bold, Code, Heading1, Heading2, Heading3, Image, Italic, Link2, List, ListChecks, ListOrdered, Minus, MoreHorizontal, Paperclip, Plus, Quote, Redo2, Strikethrough, Table2, Underline, Undo2 } from "../../shared/ui/icons";
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { safeContentUrl } from "../content/ContentRenderer";
import { DOCUMENT_BLOCKS, type DocumentBlockKind } from "../content/document-components";
import { FileContentContext } from "../files/FileContent";
import { useManagedFiles } from "../files/use-managed-files";
import { parseFileReference } from "../files/managed-files";
import { canonicalJSON, newBlockId, type NoteBlocksV2, type OrbisBlock } from "./block-model";
import { createDocumentBlock, INSERTABLE_DOCUMENT_BLOCKS } from "./tiptap-insert";
import { tiptapExtensions } from "./tiptap-extensions";
import { EditorReadOnlyContext } from "./tiptap-editor-context";
import { fromTiptapDocument, toTiptapDocument } from "./tiptap-model";
import type { EditorContentHandle } from "../documents/editor-content-handle";
import { Fragment } from "@tiptap/pm/model";
import { OrbisContentLoading, contentLoadingKey } from "./content-loading";
import type { BlockLoadState } from "../documents/content-window";
import { canJoin } from "@tiptap/pm/transform";
import { OrbisActiveBlock } from "./tiptap-active-block";
import { registerBlockActionReader, selectedBlocksNeedRead } from "./blocks/block-action-read";
import { copyBlocks } from "./blocks/block-clipboard";
import "../../styles/tiptap-editor.css";

type EditorChange = { blocks: NoteBlocksV2 };
type Command = { label: string; keywords: string; icon: ReactNode; run: (editor: Editor) => void };

function insertBlock(editor: Editor, value: OrbisBlock) {
  const node = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [value] }).content?.[0];
  if (node) editor.chain().focus().insertContent(node).run();
}

const editorExtensions = [...tiptapExtensions, OrbisBlockSelection, OrbisActiveBlock];
const EMPTY_LOAD_STATES: ReadonlyMap<string, BlockLoadState> = new Map();

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
  { label: "画板", keywords: "drawing whiteboard canvas 画板", icon: <Plus size={16} />, run: (editor) => insertBlock(editor, { id: newBlockId(), type: "drawing", props: { scene: "", url: "", caption: "画板" }, content: [], children: [] }) },
  ...INSERTABLE_DOCUMENT_BLOCKS.filter(kind => kind !== "group").map((kind: DocumentBlockKind) => ({ label: DOCUMENT_BLOCKS[kind].label, keywords: `${kind} document`, icon: <Plus size={16} />, run: (editor: Editor) => insertBlock(editor, createDocumentBlock(kind)) })),
];

function Tool({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return <ActionButton className={["重做", "斜体", "下划线", "删除线", "链接", "表格", "上传媒体或附件"].includes(title) ? "editor-secondary-tool" : undefined} type="button" title={title} aria-label={title} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</ActionButton>;
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

export function TiptapEditor({ blocks, onChange, onError, readOnly = false, noteId, onContentReady, ensureComplete, ensureBlocks, hasMoreContent = false, loadStates = EMPTY_LOAD_STATES, onLoadBlock }: {
  blocks: NoteBlocksV2;
  onChange: (next: EditorChange) => void;
  onError?: (message: string | null) => void;
  readOnly?: boolean;
  noteId?: string;
  onContentReady?: (handle: EditorContentHandle | null) => void;
  ensureComplete?: () => Promise<void>;
  ensureBlocks?: (ids: string[]) => Promise<void>;
  hasMoreContent?: boolean;
  loadStates?: ReadonlyMap<string, BlockLoadState>;
  onLoadBlock?: (id: string) => Promise<void>;
}) {
  const loadingRef = useRef(loadStates);
  const loadBlockRef = useRef(onLoadBlock);
  loadingRef.current = loadStates;
  loadBlockRef.current = onLoadBlock;
  const [extensions] = useState(() => [...editorExtensions, OrbisContentLoading.configure({ states: () => loadingRef.current, load: async id => { await loadBlockRef.current?.(id); } })]);
  const files = useManagedFiles();
  const toolbarHost = useEditorToolbarHost();
  const insertButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [insertPosition, setInsertPosition] = useState({top: 0, left: 0});
  const onChangeRef = useRef(onChange);
  const readOnlyRef = useRef(readOnly);
  const errorCallback = useRef(onError);
  errorCallback.current = onError;
  const lastEmitted = useRef<NoteBlocksV2 | null>(null);
  const contentReadyRef = useRef(onContentReady);
  const completeRef = useRef(ensureComplete);
  const blocksReaderRef = useRef(ensureBlocks);
  blocksReaderRef.current = ensureBlocks;
  const moreContentRef = useRef(hasMoreContent);
  const fullActionRef = useRef(0);
  const pendingFullAction = useRef(false);
  const pendingFullPromise = useRef<Promise<void> | null>(null);
  const pendingSelection = useRef<"all" | "end" | null>(null);
  const clipboardQueue = useRef<Promise<void>>(Promise.resolve());
  const currentEditorRef = useRef<Editor | null>(null);
  contentReadyRef.current = onContentReady;
  completeRef.current = ensureComplete;
  moreContentRef.current = hasMoreContent;
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
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  onChangeRef.current = onChange;
  readOnlyRef.current = readOnly;

  function emitChange(current: Editor) {
    if (readOnlyRef.current) return;
    try {
      const next = fromTiptapDocument(current.state.doc);
      lastEmitted.current = next;
      onChangeRef.current({ blocks: next });
      setContentError(null);
      errorCallback.current?.(null);
    } catch {
      const message = "正文暂未保存：内容转换失败。当前编辑仍保留，请重试保存。";
      setContentError(message);
      errorCallback.current?.(message);
    }
  }

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        if (pendingFullAction.current && ["c", "x"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          const ready = pendingFullPromise.current;
          const selectAll = pendingSelection.current === "all";
          const action = fullActionRef.current;
          const cut = event.key.toLowerCase() === "x";
          setClipboardNotice("正在读取完整内容并" + (cut ? "剪切" : "复制") + "…");
          clipboardQueue.current = clipboardQueue.current.catch(() => {}).then(async () => {
            if (!ready) throw new Error("完整读取尚未准备好，请重试复制。");
            await ready;
            const current = currentEditorRef.current;
            if (!current || current.isDestroyed || fullActionRef.current !== action) throw new Error("正文已变化或文档已切换，复制已取消，原内容已保留。");
            if (!selectAll) throw new Error("当前没有完整选区，请重新选择后复制。");
            const ids = locateEditorBlocks(current.state.doc).filter(entry => entry.parentId === null).map(entry => entry.id);
            const result = await copyBlocks(current, ids, cut);
            setClipboardNotice(result.message ?? (result.ok ? "已复制完整内容" : "复制失败，原内容已保留"));
          }).catch(error => setClipboardNotice(error instanceof Error ? error.message : "复制失败，原内容已保留。"));
          return true;
        }
        if (!moreContentRef.current || !completeRef.current) return false;
        if (event.key.toLowerCase() !== "a" && event.key !== "End") return false;
        event.preventDefault();
        if (pendingFullAction.current) { pendingSelection.current = event.key.toLowerCase() === "a" ? "all" : "end"; return true; }
        const action = ++fullActionRef.current;
        pendingFullAction.current = true;
        pendingSelection.current = event.key.toLowerCase() === "a" ? "all" : "end";
        const ready = completeRef.current().then(() => {
          const editor = currentEditorRef.current;
          if (fullActionRef.current !== action || !editor || editor.isDestroyed) throw new Error("正文已变化或文档已切换，完整读取已取消。");
          if (pendingSelection.current === "all") editor.chain().focus().selectAll().run();
          else editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).scrollIntoView().run();
        });
        pendingFullPromise.current = ready;
        void ready.catch(error => setClipboardNotice(error instanceof Error ? error.message : "完整读取失败，请重试。")).finally(() => {
          if (pendingFullPromise.current === ready) { pendingFullAction.current = false; pendingFullPromise.current = null; pendingSelection.current = null; }
        });
        return true;
      },
    },
    onCreate: ({ editor: current }) => {
      // Warm immutable block conversions while opening, before the first key.
      fromTiptapDocument(current.state.doc);
    },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta("orbis-content-page") || transaction.getMeta("orbis-rejected-unloaded")) return;
      fullActionRef.current += 1;
      emitChange(current);
      setSlash(slashQuery(current));
    },
    onSelectionUpdate: ({ editor: current }) => { setSlash(slashQuery(current)); },
  });
  currentEditorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    return registerBlockActionReader(editor, {
      needsRead: ids => selectedBlocksNeedRead(editor, ids, loadingRef.current),
      ensure: async ids => {
        if (!blocksReaderRef.current) throw new Error("无法读取完整子内容，操作已取消，原内容已保留。");
        await blocksReaderRef.current(ids);
      },
    });
  }, [editor]);

  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(contentLoadingKey, true));
  }, [editor, loadStates]);

  useEffect(() => {
    if (!editor) return;
    function locate(id: string) {
      let result: { node: import("@tiptap/pm/model").Node; position: number } | undefined;
      editor!.state.doc.descendants((node, position) => {
        if (result) return false;
        if (node.attrs.orbisId === id) { result = { node, position }; return false; }
      });
      if (!result) throw new Error("目标内容已不在当前编辑器中。");
      return result;
    }
    function findBlock(siblings: OrbisBlock[], id: string): OrbisBlock | undefined {
      for (const item of siblings) { if (item.id === id) return item; const nested = findBlock(item.children, id); if (nested) return nested; }
    }
    function readTransaction(transaction: import("@tiptap/pm/state").Transaction) {
      editor!.view.dispatch(transaction.setMeta("addToHistory", false).setMeta("orbis-content-page", true));
      const result = fromTiptapDocument(editor!.state.doc);
      lastEmitted.current = result;
      return result;
    }
    contentReadyRef.current?.({
      snapshot: () => fromTiptapDocument(editor.state.doc),
      appendChildren: (parentId, incoming) => {
        const target = locate(parentId);
        const current = findBlock(fromTiptapDocument(editor.state.doc).blocks, parentId);
        if (!current) throw new Error("目标内容尚未准备好。");
        const present = new Set(current.children.map(block => block.id));
        const addition = incoming.filter(block => !present.has(block.id));
        if (!addition.length) return fromTiptapDocument(editor.state.doc);
        const transaction = editor.state.tr;
        if (["orbisComponent", "orbisContainer", "blockquote", "orbisToggle", "listItem", "taskItem"].includes(target.node.type.name)) {
          const json = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: addition });
          const nodes = (json.content ?? []).map(node => editor.schema.nodeFromJSON(node));
          transaction.insert(target.position + target.node.nodeSize - 1, Fragment.fromArray(nodes));
        } else {
          const json = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [{ ...current, children: [...current.children, ...addition] }] });
          const nodes = (json.content ?? []).map(node => editor.schema.nodeFromJSON(node));
          transaction.replaceWith(target.position, target.position + target.node.nodeSize, Fragment.fromArray(nodes));
        }
        return readTransaction(transaction);
      },
      hydratePayload: incoming => {
        const target = locate(incoming.id);
        const current = findBlock(fromTiptapDocument(editor.state.doc).blocks, incoming.id);
        if (!current) throw new Error("目标内容尚未准备好。");
        const json = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [{ ...incoming, children: current.children }] });
        const nodes = (json.content ?? []).map(node => editor.schema.nodeFromJSON(node));
        return readTransaction(editor.state.tr.replaceWith(target.position, target.position + target.node.nodeSize, Fragment.fromArray(nodes)));
      },
      selectAll: () => { editor.chain().focus().selectAll().run(); },
      selectEnd: () => { editor.chain().focus().setTextSelection(editor.state.doc.content.size - 1).scrollIntoView().run(); },
      append: incoming => {
        const current = fromTiptapDocument(editor.state.doc);
        const present = new Set(current.blocks.map(block => block.id));
        const addition = incoming.filter(block => !present.has(block.id));
        if (addition.length) {
          const json = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: addition });
          const nodes = (json.content ?? []).map(node => editor.schema.nodeFromJSON(node));
          const boundary = editor.state.doc.content.size;
          const transaction = editor.state.tr.insert(boundary, Fragment.fromArray(nodes));
          // Adjacent list fragments continue the same list unless the next
          // block explicitly requests a fresh numbered sequence.
          const first = addition[0];
          if (first && ["bulletListItem", "checkListItem", "numberedListItem"].includes(first.type) && !(first.type === "numberedListItem" && Number.isInteger(first.props.start)) && canJoin(transaction.doc, boundary)) transaction.join(boundary);
          editor.view.dispatch(transaction.setMeta("addToHistory", false).setMeta("orbis-content-page", true));
        }
        const result = fromTiptapDocument(editor.state.doc);
        lastEmitted.current = result;
        return result;
      },
    });
    return () => { contentReadyRef.current?.(null); fullActionRef.current += 1; };
  }, [editor]);

  const active = useEditorState({ editor, selector: ({ editor: current }) => ({
    bold: current?.isActive("bold"), italic: current?.isActive("italic"),
    underline: current?.isActive("underline"), strike: current?.isActive("strike"),
    link: current?.isActive("link"),
    h1: current?.isActive("heading", { level: 1 }),
    h2: current?.isActive("heading", { level: 2 }),
    h3: current?.isActive("heading", { level: 3 }),
    bulletList: current?.isActive("bulletList"), orderedList: current?.isActive("orderedList"),
    taskList: current?.isActive("taskList"),
    paragraph: current?.isActive("paragraph"), quote: current?.isActive("blockquote"), codeBlock: current?.isActive("codeBlock"),
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

  useLayoutEffect(() => {
    if (!editor || (!menuOpen && !slash && !moreOpen)) return;
    const locate = () => {
      let rect: {left:number;top:number;bottom:number} | undefined = (moreOpen ? moreButtonRef : insertButtonRef).current?.getBoundingClientRect();
      if (slash) { try { rect = editor.view.coordsAtPos(editor.state.selection.from); } catch { /* Use the toolbar anchor before layout. */ } }
      if (!rect) return;
      const height = Math.min(250, window.innerHeight - 32);
      setInsertPosition({left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(570, window.innerWidth - 24) - 12)), top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))});
    };
    locate(); window.addEventListener("resize", locate);
    return () => window.removeEventListener("resize", locate);
  }, [editor, menuOpen, slash, moreOpen]);

  useEffect(() => {
    if (!menuOpen && !moreOpen && !slash) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".orbis-tiptap-menu,.editor-more-menu") || insertButtonRef.current?.contains(target) || moreButtonRef.current?.contains(target)) return;
      setMenuOpen(false); setMoreOpen(false); setSlash(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen, moreOpen, slash]);

  function setParagraphType(value: string) {
    if (!editor) return;
    const [target, level] = value.split(":");
    const ids = blockSelectionKey.getState(editor.state)?.ids ?? [];
    if (ids.length) {
      const result = executeBlockCommand(editor, ids, {type:"convert",target,level:level ? Number(level) : undefined});
      if (result.ok) setBlockSelection(editor, result.selectedIds);
      else setUploadError(result.message ?? "无法转换所选内容");
      return;
    }
    const chain = editor.chain().focus();
    if (target === "heading") chain.setHeading({level: Number(level) as 1|2|3}).run();
    else if (target === "bulletListItem") chain.toggleBulletList().run();
    else if (target === "numberedListItem") chain.toggleOrderedList().run();
    else if (target === "checkListItem") chain.toggleTaskList().run();
    else if (target === "quote") chain.toggleBlockquote().run();
    else if (target === "codeBlock") chain.toggleCodeBlock().run();
    else chain.setParagraph().run();
  }

  function toggleMark(name: string) {
    if (!editor) return;
    const ids = new Set(blockSelectionKey.getState(editor.state)?.ids);
    if (!ids.size) { editor.chain().focus().toggleMark(name).run(); return; }
    const mark = editor.schema.marks[name];
    const entries = locateEditorBlocks(editor.state.doc).filter(entry => ids.has(entry.id));
    const remove = entries.every(entry => editor.state.doc.rangeHasMark(entry.pos, entry.pos + entry.node.nodeSize, mark));
    let tr = editor.state.tr;
    for (const entry of entries) tr = remove ? tr.removeMark(entry.pos, entry.pos + entry.node.nodeSize, mark) : tr.addMark(entry.pos, entry.pos + entry.node.nodeSize, mark.create());
    editor.view.dispatch(tr); editor.view.focus();
  }

  const formatToolbar = !readOnly && editor ? <div className="orbis-tiptap-toolbar" role="toolbar" aria-label="文档格式">
      <SelectField density="compact" aria-label="段落类型" className="editor-block-type" value={active?.h1 ? "heading:1" : active?.h2 ? "heading:2" : active?.h3 ? "heading:3" : active?.bulletList ? "bulletListItem" : active?.orderedList ? "numberedListItem" : active?.taskList ? "checkListItem" : active?.quote ? "quote" : active?.codeBlock ? "codeBlock" : "paragraph"} options={[{value:"paragraph",label:"正文"},{value:"heading:1",label:"标题 1"},{value:"heading:2",label:"标题 2"},{value:"heading:3",label:"标题 3"},{value:"bulletListItem",label:"无序列表"},{value:"numberedListItem",label:"有序列表"},{value:"checkListItem",label:"任务清单"},{value:"quote",label:"引用"},{value:"codeBlock",label:"代码块"}]} onChange={setParagraphType} />
      <span className="orbis-tiptap-toolbar-divider" />
      <Tool title="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></Tool>
      <Tool title="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></Tool>
      <span className="orbis-tiptap-toolbar-divider" />
      <Tool title="粗体" active={active?.bold} onClick={() => toggleMark("bold")}><Bold size={16} /></Tool>
      <Tool title="斜体" active={active?.italic} onClick={() => toggleMark("italic")}><Italic size={16} /></Tool>
      <Tool title="下划线" active={active?.underline} onClick={() => toggleMark("underline")}><Underline size={16} /></Tool>
      <Tool title="删除线" active={active?.strike} onClick={() => toggleMark("strike")}><Strikethrough size={16} /></Tool>
      <Tool title="链接" active={active?.link} onClick={() => inlineLink(editor)}><Link2 size={16} /></Tool>
      <span className="orbis-tiptap-toolbar-divider" />
      <Tool title="表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></Tool>
      <Tool title="上传媒体或附件" onClick={() => inputRef.current?.click()}><Image size={16} /><Paperclip size={13} /></Tool>
      <ActionButton ref={moreButtonRef} className="editor-more-tools" aria-label="更多格式" aria-expanded={moreOpen} onClick={() => { setMenuOpen(false); setSlash(null); setMoreOpen(value => !value); }}><MoreHorizontal size={17}/></ActionButton>
      <ActionButton ref={insertButtonRef} type="button" className="orbis-tiptap-insert" aria-label="插入内容" aria-expanded={menuOpen} onClick={() => { setMoreOpen(false); setActiveCommand(0); setMenuOpen((value) => !value); }}><Plus size={15} />插入</ActionButton>
      <input ref={inputRef} type="file" aria-label="选择上传文件" hidden onChange={(event) => void upload(event)} />
    </div> : null;

  const visible = slash ? COMMANDS.filter((item) => `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(slash.query)) : COMMANDS;
  return <EditorReadOnlyContext.Provider value={readOnly}><FileContentContext.Provider value={files}><div className="orbis-tiptap document-prose" data-testid="orbis-tiptap-editor" onKeyDownCapture={(event) => {
    if (moreOpen) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMoreOpen(false); moreButtonRef.current?.focus(); } return; }
    if (readOnly || (!menuOpen && !slash)) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); setSlash(null); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      setActiveCommand((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % Math.max(visible.length, 1));
    } else if (event.key === "Enter" && visible.length) { event.preventDefault(); event.stopPropagation(); run(visible[activeCommand % visible.length]); }
  }}>
    {toolbarHost ? createPortal(formatToolbar, toolbarHost) : formatToolbar}
    {!readOnly && editor && moreOpen ? createPortal(<div className="editor-more-menu" role="menu" aria-label="更多格式" style={insertPosition} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }}>{[
      {label:"当前块操作", run:()=>requestBlockMenu(editor)},
      {label:"斜体", run:()=>toggleMark("italic")}, {label:"下划线", run:()=>toggleMark("underline")},
      {label:"删除线", run:()=>toggleMark("strike")}, {label:"链接", run:()=>inlineLink(editor)},
      {label:"重做", run:()=>editor.chain().focus().redo().run()},
      {label:"表格", run:()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()},
      {label:"上传媒体或附件", run:()=>inputRef.current?.click()},
    ].map(item=><ActionButton key={item.label} role="menuitem" onMouseDown={event=>event.preventDefault()} onClick={()=>{item.run();setMoreOpen(false);}}>{item.label}</ActionButton>)}</div>,document.body) : null}
    {uploadError ? <p role="alert" className="orbis-tiptap-error">{uploadError}</p> : null}
    {contentError ? <div role="alert" className="orbis-tiptap-error"><p>{contentError}</p><ActionButton type="button" disabled={readOnly} onClick={() => editor && emitChange(editor)}>重试保存正文</ActionButton></div> : null}
    {clipboardNotice ? <div role="status" className="orbis-block-notice">{clipboardNotice}<button type="button" aria-label="关闭复制提示" onClick={() => setClipboardNotice(null)}>×</button></div> : null}
    {!readOnly && editor && (slash || menuOpen) ? createPortal(<div style={insertPosition} className="orbis-tiptap-menu" role="listbox" aria-label="插入内容">{visible.length ? visible.map((item, index) => <ActionButton type="button" role="option" aria-selected={index === activeCommand % visible.length} key={item.label} onMouseDown={(event) => event.preventDefault()} onClick={() => run(item)}>{item.icon}{item.label}</ActionButton>) : <p>没有匹配的内容块</p>}</div>, document.body) : null}
    {editor ? <BlockControls editor={editor} readOnly={readOnly} noteId={noteId} /> : null}
    <EditorContent editor={editor} aria-label="文档正文" />
  </div></FileContentContext.Provider></EditorReadOnlyContext.Provider>;
}
