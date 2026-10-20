import { expect, it, vi } from "vitest";
import { createEditorDraftFingerprint, type EditorDraft } from "./editor-draft";
import { EditorOutlineStore } from "./EditorLayout";
import { AutosaveCoordinator } from "./autosave";
import type { OrbisBlock } from "../../content/model/blocks";

const paragraph = (id: string, text = "body"): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });
const draft = (blocks: OrbisBlock[]): EditorDraft => ({ title: "Title", blocks: { schema_version: 2, editor: "blocknote", blocks }, version: 1 });

it("reuses immutable block signatures while detecting edits, undo and unknown stored fields", () => {
  const read = vi.fn(() => "preserved");
  const untouched = { ...paragraph("second"), props: { get customProperty() { return read(); } } };
  const saved = draft([paragraph("first"), untouched]);
  const fingerprint = createEditorDraftFingerprint();
  const original = fingerprint(saved);
  read.mockClear();
  expect(fingerprint(draft([paragraph("first", "changed"), untouched]))).not.toBe(original);
  expect(read).not.toHaveBeenCalled();
  expect(fingerprint(draft([paragraph("first"), untouched]))).toBe(original);
  expect(fingerprint({ ...saved, title: " Title ", version: 42 })).toBe(original);
  expect(fingerprint(draft([paragraph("first"), { ...untouched, props: { customProperty: "new" } }]))).not.toBe(original);
});

it("compares JSONB key ordering equally and preserves nested content changes", () => {
  const fingerprint = createEditorDraftFingerprint();
  const first = draft([{ ...paragraph("p"), props: { alpha: 1, beta: 2 }, children: [paragraph("nested")] }]);
  const reordered = draft([{ ...first.blocks.blocks[0], props: { beta: 2, alpha: 1 } }]);
  expect(fingerprint(reordered)).toBe(fingerprint(first));
  expect(fingerprint(draft([{ ...first.blocks.blocks[0], children: [paragraph("nested", "new")] }]))).not.toBe(fingerprint(first));
});

it("does not recompute saved fingerprints on every input and skips saving an undone edit", async () => {
  const fingerprint = vi.fn(createEditorDraftFingerprint());
  const save = vi.fn(async (value: EditorDraft) => value);
  const coordinator = new AutosaveCoordinator({ delayMs: 750, fingerprint, save });
  const saved = draft([paragraph("p")]);
  coordinator.hydrate(saved);
  coordinator.change(draft([paragraph("p", "edit")]));
  expect(fingerprint).toHaveBeenCalledTimes(2);
  coordinator.change(draft([paragraph("p")]));
  await coordinator.flush();
  expect(coordinator.state).toBe("saved");
  expect(save).not.toHaveBeenCalled();
  expect(fingerprint).toHaveBeenCalledTimes(3);
  coordinator.dispose();
});

it("does not notify outline subscribers for body edits and keeps stable heading IDs", () => {
  const outline = new EditorOutlineStore();
  const heading = { ...paragraph("heading", "Chapter"), type: "heading", props: { level: 2 } };
  outline.update(draft([heading, paragraph("p")]).blocks);
  const initial = outline.snapshot();
  const changed = vi.fn();
  outline.subscribe(changed);
  outline.update(draft([heading, paragraph("p", "Body changed")]).blocks);
  expect(changed).not.toHaveBeenCalled();
  expect(outline.snapshot()).toBe(initial);
  outline.update(draft([{ ...heading, content: [{ type: "text", text: "Renamed" }] }]).blocks);
  expect(changed).toHaveBeenCalledOnce();
  expect(outline.snapshot()).toEqual([{ id: "heading", text: "Renamed", level: 2 }]);
});

it("keeps indexed headings in unread containers, replaces hydrated text and removes deleted roots",()=>{
  const outline=new EditorOutlineStore();
  const root={...paragraph("container"),type:"group",children:[]};
  const tail={...paragraph("tail","Tail"),type:"heading",props:{level:1}};
  outline.setSourceRoots([root,tail]);outline.setBoundary(2);
  const unread={id:root.id,parent_id:null,child_count:1,has_children:true,children_loaded:false,payload_loaded:true,payload_bytes:20,cursor:null,loaded_count:0};
  outline.setReadState(new Map([[root.id,unread]]));
  outline.update(draft([root,tail]).blocks);
  outline.setRemote([{id:"nested",text:"Indexed",level:2,parent_id:root.id,root_index:0},{id:tail.id,text:"Tail",level:1,parent_id:null,root_index:1}],2);
  expect(outline.snapshot().map(heading=>heading.text)).toEqual(["Indexed","Tail"]);
  const nested={...paragraph("nested","Hydrated"),type:"heading",props:{level:2}};
  outline.setReadState(new Map([[root.id,{...unread,children_loaded:true}]]));
  outline.update(draft([{...root,children:[nested]},tail]).blocks);
  expect(outline.snapshot().map(heading=>heading.text)).toEqual(["Hydrated","Tail"]);
  outline.update(draft([tail]).blocks);
  expect(outline.snapshot().map(heading=>heading.text)).toEqual(["Tail"]);
});
