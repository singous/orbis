import { expect,it,vi } from "vitest";
import { ApiError } from "../../../shared/api/api-client";
import { DocumentWriter,type PendingDocumentWrite } from "./document-writer";
import type { EditorDraft } from "./editor-draft";
const did="00000000-0000-4000-8000-000000000001",bid="00000000-0000-4000-8000-000000000002";
const draft=(text:string):EditorDraft=>({title:"文档",version:1,blocks:{schema_version:2,editor:"blocknote",blocks:[{id:bid,type:"paragraph",props:{},content:[{type:"text",text}],children:[]}]}});
it("resolves the original submitted snapshot before saving later typing",async()=>{
  const sent:PendingDocumentWrite[]=[],events:string[]=[];
  const write=vi.fn(async(pending:PendingDocumentWrite)=>{sent.push(structuredClone(pending));events.push("write");if(sent.length===1)throw new ApiError(503,"unknown","DOCUMENT_WRITE_RESULT_UNKNOWN");return {content_version:sent.length,title:"文档"};});
  const writer=new DocumentWriter({documentId:did,write,checkpoint:async(_pending,flush)=>{events.push(flush?"persist":"schedule");}});
  await expect(writer.save(draft("A"),draft("old"),false)).rejects.toMatchObject({code:"DOCUMENT_WRITE_RESULT_UNKNOWN"});
  const id=writer.pending!.operation_id;
  const saved=await writer.save(draft("B"),draft("old"),false);
  expect(saved.blocks.blocks[0].content).toEqual([{type:"text",text:"A"}]);
  expect(saved.version).toBe(2);
  expect(sent[1].operation_id).toBe(id);
  expect(sent[1].operations).toEqual(sent[0].operations);
  expect(events[0]).toBe("persist");
  await writer.save(draft("B"),saved,false);
  expect(sent[2].operation_id).not.toBe(id);
  expect(sent[2].expected_version).toBe(2);
});
it("restores a prepared intent and keeps it through a later authorization failure",async()=>{
  let retained:PendingDocumentWrite|null=null;
  const first=new DocumentWriter({documentId:did,checkpoint:async value=>{retained=value?structuredClone(value):null;},write:async()=>{throw new ApiError(503,"unknown","DOCUMENT_WRITE_RESULT_UNKNOWN");}});
  await expect(first.save(draft("A"),draft("old"),false)).rejects.toThrow();
  const second=new DocumentWriter({documentId:did,checkpoint:async()=>{},write:async()=>{throw new ApiError(403,"denied");}});
  second.restore(retained);
  await expect(second.save(draft("B"),draft("old"),false)).rejects.toMatchObject({code:"DOCUMENT_WRITE_RESULT_UNKNOWN"});
  expect(second.pending?.operation_id).toBe(first.pending?.operation_id);
});
it("continues online saves when local storage fails and clears definitively rejected new input",async()=>{
  const write=vi.fn().mockRejectedValueOnce(new ApiError(422,"invalid")).mockResolvedValueOnce({content_version:2,title:"文档"});
  const writer=new DocumentWriter({documentId:did,checkpoint:async()=>{throw new Error("local storage unavailable");},write});
  await expect(writer.save(draft("bad"),draft("old"),true)).rejects.toMatchObject({status:422});
  expect(writer.pending).toBeNull();
  await writer.save(draft("good"),draft("old"),true);
  expect(write).toHaveBeenCalledTimes(2);
});

it("treats every restored prepared intent as potentially transmitted",async()=>{
  const original=new DocumentWriter({documentId:did,checkpoint:async()=>{},write:async()=>{throw new Error("lost response");}});
  await expect(original.save(draft("A"),draft("old"),false)).rejects.toThrow();
  const prepared={...original.pending!,uncertain:false};
  const restored=new DocumentWriter({documentId:did,checkpoint:async()=>{},write:async()=>{throw new ApiError(403,"permission changed");}});
  restored.restore(prepared);
  await expect(restored.save(draft("B"),draft("old"),false)).rejects.toMatchObject({code:"DOCUMENT_WRITE_RESULT_UNKNOWN"});
  expect(restored.pending?.operation_id).toBe(prepared.operation_id);
  expect(restored.pending?.submitted.blocks).toEqual(draft("A").blocks);
});
