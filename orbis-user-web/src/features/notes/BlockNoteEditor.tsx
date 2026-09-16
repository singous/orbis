import { zh } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BookOpen } from "lucide-react";
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
import { useManagedFiles } from "../files/use-managed-files";

import {
  canonicalJSON,
  extractPlainTextV2,
  toV2,
  type NoteBlocksV2,
  type OrbisBlock,
} from "./block-model";
import { createDocumentBlock, documentBlockDefinition, documentEditorSchema, documentEditorExtensions, DocumentEditorReadOnly, INSERTABLE_DOCUMENT_BLOCKS } from "./DocumentBlockEditor";

export function BlockNoteEditor({
  blocks,
  onChange,
  readOnly = false,
}: {
  blocks: NoteBlocksV2;
  onChange: (next: { blocks: NoteBlocksV2; plainText: string }) => void;
  readOnly?: boolean;
}) {
  const files = useManagedFiles();
  // OrbisBlock mirrors BlockNote's Block shape; cast to avoid deep inline-style
  // generic friction (content is validated at the API boundary).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ schema: documentEditorSchema, extensions: documentEditorExtensions, dictionary: zh, uploadFile: files.upload, resolveFileUrl: files.resolve, initialContent: blocks.blocks as any });
  const lastEmitted = useRef<OrbisBlock[] | null>(null);
  const lastApplied = useRef(blocks.blocks);

  // Push external content into the editor. Bail-outs keep this from stomping
  // the live document (cursor loss, flicker, slash-menu queries surviving as
  // literal "/" text):
  // 1. our own onChange round-trips the identical array reference;
  // 2. a re-render with the content the editor was created/last synced with
  //    (also covers the StrictMode double effect on mount);
  // 3. server echoes of the current document — JSONB key-reordered and with
  //    BlockNote-normalized props, but semantically identical.
  useEffect(() => {
    if (!editor) return;
    if (blocks.blocks === lastEmitted.current) return;
    if (canonicalJSON(blocks.blocks) === canonicalJSON(lastApplied.current)) return;
    const current = toV2({ schema_version: 2, editor: "blocknote", blocks: editor.document as unknown as OrbisBlock[] });
    if (canonicalJSON(blocks.blocks) === canonicalJSON(current.blocks)) return;
    lastApplied.current = blocks.blocks;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.replaceBlocks(editor.document, blocks.blocks as any);
  }, [blocks.blocks, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.isEditable = !readOnly;
  }, [editor, readOnly]);

  return (
    <DocumentEditorReadOnly.Provider value={readOnly}><BlockNoteView
      editor={editor}
      className="orbis-bn"
      theme="light"
      editable={!readOnly}
      slashMenu={false}
      onChange={() => {
        if (readOnly) return;
        const doc = editor.document as unknown as OrbisBlock[];
        const next: NoteBlocksV2 = {
          schema_version: 2,
          editor: "blocknote",
          blocks: doc,
        };
        lastEmitted.current = doc;
        onChange({ blocks: next, plainText: extractPlainTextV2(doc) });
      }}
    ><SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems([
      ...getDefaultReactSlashMenuItems(editor),
      ...INSERTABLE_DOCUMENT_BLOCKS.map((kind) => ({
        title: documentBlockDefinition(kind)!.label,
        group: "文档组件",
        aliases: [kind, kind.toLowerCase()],
        icon: <BookOpen size={17} />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, createDocumentBlock(kind) as typeof documentEditorSchema.PartialBlock),
      })),
    ], query)} /></BlockNoteView></DocumentEditorReadOnly.Provider>
  );
}
