import {afterEach,expect,it,vi} from "vitest";
import {Editor} from "@tiptap/core";
import {tiptapExtensions} from "./tiptap-extensions";
import {fromTiptapDocument,toTiptapDocument} from "./tiptap-model";
import {executeBlockCommand,locateEditorBlocks} from "./blocks/block-commands";
import {registerDocumentCopy} from "./blocks/block-copy-context";
import {serializeBlockClipboard,parseBlockClipboard} from "./blocks/block-clipboard";
import {AutosaveCoordinator} from "./autosave";
import {DocumentWriter,type PendingDocumentWrite} from "./document-writer";
import {createEditorDraftFingerprint,type EditorDraft} from "./editor-draft";
import {annotateTableCopies,resolveTableCopies,type TableCopyIntent,type ResolvedCopyBlock} from "./table-copy";

const id=(suffix:string)=>`00000000-0000-4000-8000-${suffix.padStart(12,"0")}`;
const origin={workspace_id:id("1"),document_id:id("2"),document_version:3};
const source={id:id("3"),type:"dataTable",props:{table_id:id("4"),table_revision:2},content:[],children:[]};
const copied={...source,id:id("5")};
const copy:TableCopyIntent={block_id:copied.id,source:{...origin,table_id:id("4")}};
const resolved:ResolvedCopyBlock={id:copied.id,payload:{type:"data_table",props:{table_id:id("6"),table_version:1},content:[]}};
const initial:EditorDraft={title:"来源",version:3,blocks:{schema_version:2,editor:"blocknote",blocks:[source]}};
const editors:Editor[]=[];
afterEach(()=>{editors.splice(0).forEach(editor=>editor.destroy());});

it("keeps initialized table references and their source snapshot in structured clipboard data",()=>{
  const table={...source,props:{...source.props,title:"需求",default_view_id:id("7"),field_names:"标题"}};
  const editor=new Editor({extensions:tiptapExtensions,content:toTiptapDocument({...initial.blocks,blocks:[table]})});editors.push(editor);
  registerDocumentCopy(editor,{origin:()=>origin,prepare:async()=>{},stage:()=>()=>{},commit:async()=>{}});
  const clipboard=parseBlockClipboard(serializeBlockClipboard(editor,[source.id]).structured)!;
  expect(clipboard.origin).toEqual(origin);
  expect(clipboard.blocks[0].props).toEqual(table.props);
});

it("retries the original copy after reload and preserves later title edits",async()=>{
  const current=annotateTableCopies({...initial,blocks:{...initial.blocks,blocks:[source,copied]}},new Map([[copied.id,copy]]));
  let retained:PendingDocumentWrite|null=null;
  const first=new DocumentWriter({documentId:origin.document_id,checkpoint:async pending=>{retained=pending?structuredClone(pending):null;},write:async()=>{throw new Error("response lost");}});
  await expect(first.save(current,initial,false)).rejects.toThrow("response lost");
  const sent:PendingDocumentWrite[]=[];
  let coordinator:AutosaveCoordinator<EditorDraft>;
  const writer=new DocumentWriter({documentId:origin.document_id,checkpoint:async()=>{},write:async pending=>{sent.push(structuredClone(pending));return {content_version:sent.length+3,title:pending.submitted.title,resolved_blocks:pending.table_copies?.length?[resolved]:undefined};},onResolved:(copies,blocks,version)=>coordinator.alignCurrentAfterRead(resolveTableCopies(coordinator.current!,copies,blocks,version))});
  writer.restore(retained);
  coordinator=new AutosaveCoordinator({delayMs:100_000,fingerprint:createEditorDraftFingerprint(),hasPendingWrite:()=>!!writer.pending,save:(draft,saved)=>writer.save(draft,saved,false)});
  coordinator.hydrate(initial);
  coordinator.change({...current,title:"后来输入的标题"});
  await coordinator.flush();
  expect(sent[0].operation_id).toBe(first.pending!.operation_id);
  expect(sent[0].table_copies).toEqual([copy]);
  expect(coordinator.saved?.title).toBe("来源");
  expect(coordinator.current?.title).toBe("后来输入的标题");
  expect(coordinator.current?.blocks.blocks[1].props.table_id).toBe(id("6"));
  await coordinator.flush();
  expect(sent[1].table_copies).toBeUndefined();
  expect(sent[1].expected_version).toBe(4);
  expect(coordinator.state).toBe("saved");
  coordinator.dispose();
});

it("does not resurrect a deleted copy or replace a later conversion when its receipt arrives",()=>{
  const draft={...initial,tableCopies:[copy],blocks:{...initial.blocks,blocks:[{...copied,type:"paragraph",props:{},content:"后来转换的段落"}]}};
  expect(resolveTableCopies(draft,[copy],[resolved],4).blocks.blocks).toEqual(draft.blocks.blocks);
  expect(resolveTableCopies({...draft,blocks:{...draft.blocks,blocks:[]}},[copy],[resolved],4).blocks.blocks).toEqual([]);
});

it("stages nested table clones before emitting the document change and keeps resolved refs through undo/redo",()=>{
  const editor=new Editor({extensions:tiptapExtensions,content:toTiptapDocument(initial.blocks)});editors.push(editor);
  const stage=vi.fn((_copies:TableCopyIntent[])=>()=>{}),commit=vi.fn(async()=>{});
  registerDocumentCopy(editor,{origin:()=>origin,prepare:async()=>{},stage,commit});
  editor.on("update",()=>expect(stage).toHaveBeenCalledTimes(1));
  const result=executeBlockCommand(editor,[source.id],{type:"duplicate"});
  expect(result.ok).toBe(true);
  const target=result.selectedIds![0];
  expect(stage.mock.calls[0][0]).toEqual([{...copy,block_id:target}]);
  const entry=locateEditorBlocks(editor.state.doc).find(block=>block.id===target)!;
  const props={...entry.node.attrs.orbisProps,table_id:id("6"),table_revision:1};
  const replacement=entry.node.type.create({...entry.node.attrs,orbisProps:props},entry.node.content);
  editor.view.dispatch(editor.state.tr.replaceWith(entry.pos,entry.pos+entry.node.nodeSize,replacement).setMeta("addToHistory",false).setMeta("orbis-content-page",true));
  editor.commands.undo();
  expect(fromTiptapDocument(editor.state.doc).blocks).toHaveLength(1);
  editor.commands.redo();
  expect(fromTiptapDocument(editor.state.doc).blocks[1].props.table_id).toBe(id("6"));
  expect(commit).toHaveBeenCalledTimes(1);
});
