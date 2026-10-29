import { reportError } from "../../shared/api/request-feedback";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { Bold, Code, Image, Italic, Link2, List, ListChecks, Paperclip } from "../../shared/ui/icons";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent, DialogFooter } from "../../shared/ui/Dialog";
import { TextInput } from "../../shared/ui/TextInput";
import { nativeBlock, editorBlock, type NativeBlock } from "../content/codecs/api-content";
import { createEmptyV2, newBlockId, type NoteBlocksV2 } from "../content/blocks";
import { safeContentUrl } from "../content/ContentRenderer";
import { tiptapExtensions } from "../documents/editor/tiptap-extensions";
import { fromTiptapDocument, toTiptapDocumentForSchema, toTiptapDocument } from "../documents/editor/tiptap-model";
import { FileContentContext } from "../files/FileContent";
import { useManagedFiles } from "../files/use-managed-files";
import "../../styles/tiptap-editor.css";

const EXTENSIONS = new Set(["starterKit", "codeBlock", "underline", "link", "placeholder", "taskList", "taskItem", "orbisMetadata", "orbisStyle", "orbisMedia", "orbisBlockIds", "orbisCodeHighlight", "orbisMarkdownPaste"]);
const extensions = tiptapExtensions.filter(extension => EXTENSIONS.has(extension.name)).map(extension => extension.name === "placeholder" ? extension.configure({ placeholder: "想到什么，随手记下…" }) : extension);
const homeExtensions = extensions.map(extension => extension.name === "placeholder" ? extension.configure({ placeholder: "先记下来，灵感可不等人。" }) : extension);
export function editorBlocks(blocks: NativeBlock[]): NoteBlocksV2 {
  return blocks.length ? { schema_version: 2, editor: "blocknote", blocks: blocks.map(editorBlock) } : createEmptyV2();
}

export function QuickNoteEditor({ initialValue, onChange, onSubmit, onError, onBusy, disabled = false, homeActions }: {
  initialValue: NativeBlock[]; onChange: (blocks: NativeBlock[]) => void; onSubmit: () => void;
  onError: (error: unknown) => void; onBusy: (busy: boolean) => void; disabled?: boolean; homeActions?: ReactNode;
}) {
  const files = useManagedFiles("/quick-note-assets");
  const callbacks = useRef({ onChange, onSubmit, onError, onBusy });
  callbacks.current = { onChange, onSubmit, onError, onBusy };
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");

  const uploadInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const editor = useEditor({
    extensions: homeActions ? homeExtensions : extensions, content: toTiptapDocument(editorBlocks(initialValue)), editable: !disabled,
    editorProps: { attributes: { role: "textbox", "aria-label": "随手记正文", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); callbacks.current.onSubmit(); return true; }
        return false;
      },
      handlePaste: (_view, event) => {
        const file = event.clipboardData?.files[0];
        if (file) { event.preventDefault(); void upload(file); return true; }
        return false;
      },
      handleDrop: (_view, event) => {
        const file = event.dataTransfer?.files[0];
        if (file) { event.preventDefault(); void upload(file); return true; }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      try { callbacks.current.onChange(fromTiptapDocument(editor.getJSON()).blocks.map(nativeBlock)); }
      catch (error) { callbacks.current.onError(error); }
    },
  });
  useEffect(() => { editor?.setEditable(!disabled && !uploading, false); }, [editor, disabled, uploading]);
  const active = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive("bold"), italic: editor?.isActive("italic"), list: editor?.isActive("bulletList"), task: editor?.isActive("taskList"), code: editor?.isActive("codeBlock"), characters: homeActions ? Array.from(editor?.getText() ?? "").length : 0 }) });

  async function upload(file: File) {
    if (!editor || disabled || uploadLock.current) return;
    uploadLock.current = true; setUploading(true); callbacks.current.onBusy(true);
    try {
      const reference = await files.upload(file);
      if (!mounted.current || editor.isDestroyed) return;
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "file";
      const block = { id: newBlockId(), type: kind, props: { url: reference, name: file.name }, content: [], children: [] };
      const node = toTiptapDocumentForSchema({ schema_version: 2, editor: "blocknote", blocks: [block] }, editor.schema).content?.[0];
      if (node) editor.chain().focus().insertContent(node).run();
    } catch (error) { if (mounted.current) callbacks.current.onError(error); }
    finally { uploadLock.current = false; if (mounted.current) { setUploading(false); callbacks.current.onBusy(false); } }
  }
  function tool(label: string, icon: ReactNode, run: (editor: Editor) => void, pressed?: boolean) {
    return <ActionButton type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled || uploading || !editor} onMouseDown={event => event.preventDefault()} onClick={() => editor && run(editor)}>{icon}</ActionButton>;
  }
  return <FileContentContext.Provider value={files}>
    <div className="quick-note-editor orbis-tiptap">
      <div className="quick-note-tools" role="toolbar" aria-label="随手记格式">
        {tool("插入图片", <Image size={17} />, () => imageInput.current?.click())}
        {tool("待办清单", <ListChecks size={17} />, editor => editor.chain().focus().toggleTaskList().run(), active?.task)}
        {tool("插入链接", <Link2 size={17} />, editor => { setLink(String(editor.getAttributes("link").href ?? ""));  setLinkOpen(true); })}
        {tool("添加附件", <Paperclip size={17} />, () => uploadInput.current?.click())}
        <span className="quick-note-tool-divider" />
        {tool("加粗", <Bold size={17} />, editor => editor.chain().focus().toggleBold().run(), active?.bold)}
        {tool("斜体", <Italic size={17} />, editor => editor.chain().focus().toggleItalic().run(), active?.italic)}
        {tool("无序列表", <List size={17} />, editor => editor.chain().focus().toggleBulletList().run(), active?.list)}
        {tool("代码块", <Code size={17} />, editor => editor.chain().focus().toggleCodeBlock().run(), active?.code)}
      </div>
      {homeActions ? <div className="home-note-field"><EditorContent editor={editor} /><span className="home-note-count">{active?.characters ?? 0} 字</span></div> : <EditorContent editor={editor} />}
      {homeActions ? <div className="home-note-actions">
        <ActionButton type="button" className="home-note-attachment" disabled={disabled || uploading || !editor} onClick={() => uploadInput.current?.click()}><Paperclip size={20} aria-hidden="true" />添加附件</ActionButton>
        {homeActions}
      </div> : null}
      <input ref={imageInput} className="sr-only" type="file" accept="image/*" aria-label="选择随手记图片" tabIndex={-1} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      <input ref={uploadInput} className="sr-only" type="file" aria-label="选择随手记附件" tabIndex={-1} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      {uploading ? <p role="status" className="quick-note-hint">正在上传附件…</p> : null}
    </div>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent title="插入链接">
      <form onSubmit={event => { event.preventDefault(); const url = link.trim(); if (url && !safeContentUrl(url)) { reportError("请输入有效的 HTTP(S)、邮件或锚点链接"); return; } if (url) editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run(); else editor?.chain().focus().unsetLink().run(); setLinkOpen(false); }}>
        <TextInput label="链接地址" value={link} onChange={event => setLink(event.target.value)} autoFocus placeholder="https://" />

        <DialogFooter><Button type="submit" variant="primary">确定</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </FileContentContext.Provider>;
}
