import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import { transform, type TransformResult } from "../src/engine";
import { EngineError } from "../src/protocol";
import { fingerprintElement } from "../../frontend/src/features/content/codecs/collaboration-fingerprint";
import type { NativeBlock } from "../../frontend/src/features/content/codecs/api-content";

const id = () => randomUUID();
const run = (text: string) => ({ text, marks: [] as string[], href: null });
function paragraph(text = "Base", blockId = id()): NativeBlock { return { id: blockId, type: "paragraph", props: {}, content: [run(text)] as NativeBlock["content"], children: [] }; }
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
function load(state: string) { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(state, "base64")); return doc; }
function node(doc: Y.Doc, blockId: string): Y.XmlElement {
  let found: Y.XmlElement | undefined;
  const visit = (fragment: Y.XmlFragment) => {
    for (const child of fragment.toArray()) if (child instanceof Y.XmlElement) {
      if (child.getAttribute("orbisId") === blockId && !child.getAttribute("orbisOwn")) found = child;
      visit(child);
    }
  };
  visit(doc.getXmlFragment("body"));
  assert.ok(found);
  return found;
}
function text(doc: Y.Doc, blockId: string): Y.XmlText { const value = node(doc, blockId).get(0); assert.ok(value instanceof Y.XmlText); return value; }
function merge(state: string, doc: Y.Doc) { return transform({ state, blocks: null, update: encode(Y.encodeStateAsUpdate(doc)) }); }
function seed(blocks = [paragraph()]): TransformResult { return transform({ state: null, blocks, update: null }); }
function bytes(state: string) { return Buffer.from(state, "base64"); }
function content(block: NativeBlock) { return block.content.map(run => run.text).join(""); }

describe("persistent Yjs body engine", () => {
  it("seeds exactly once and reads without changing binary identities", () => {
    const blocks = [paragraph()];
    const initial = seed(blocks);
    assert.deepEqual(initial.blocks, blocks);
    const read = transform({ state: initial.state, blocks: null, update: null });
    assert.equal(read.changed, false);
    assert.deepEqual(bytes(read.state), bytes(initial.state));
    const same = transform({ state: initial.state, blocks, update: null });
    assert.equal(same.changed, false);
    assert.equal(same.state, initial.state);
  });

  it("merges concurrent inserts and rich text marks, repeated or reordered, after reload", () => {
    const p = paragraph();
    const initial = seed([p]);
    const a = load(initial.state), b = load(initial.state);
    text(a, p.id).insert(4, " A");
    text(b, p.id).format(0, 4, { bold: {} });
    text(b, p.id).insert(4, " B");
    const first = merge(initial.state, a), merged = merge(first.state, b);
    const reordered = merge(merge(initial.state, b).state, a);
    assert.deepEqual(merged.blocks, reordered.blocks);
    assert.match(content(merged.blocks[0]), / A/);
    assert.match(content(merged.blocks[0]), / B/);
    assert.ok(merged.blocks[0].content.some(value => value.marks.includes("bold")));
    const duplicate = merge(merged.state, a);
    assert.equal(duplicate.changed, false);
    assert.deepEqual(duplicate.blocks, merged.blocks);
    const restored = load(merged.state);
    text(restored, p.id).insert(text(restored, p.id).length, " reconnected");
    assert.match(content(merge(merged.state, restored).blocks[0]), /reconnected$/);
    a.destroy(); b.destroy(); restored.destroy();
  });

  it("keeps browser identities when API commands update an unrelated block", () => {
    const first = paragraph("one"), second = paragraph("two");
    const initial = seed([first, second]);
    const browser = load(initial.state);
    text(browser, first.id).insert(3, " browser");
    const cli = transform({ state: initial.state, update: null, blocks: [first, { ...second, content: [run("CLI edit")] as NativeBlock["content"] }] });
    const merged = merge(cli.state, browser);
    assert.equal(content(merged.blocks[0]), "one browser");
    assert.equal(content(merged.blocks[1]), "CLI edit");
    assert.deepEqual(merged.blocks.map(block => block.id), [first.id, second.id]);
    browser.destroy();
  });

  it("applies API text edits incrementally to the same rich text identity", () => {
    const p = paragraph("hello world");
    const initial = seed([p]);
    const browser = load(initial.state);
    text(browser, p.id).insert(0, "browser ");
    const cli = transform({ state: initial.state, update: null, blocks: [{ ...p, content: [run("hello earth")] as NativeBlock["content"] }] });
    const merged = merge(cli.state, browser);
    assert.equal(content(merged.blocks[0]), "browser hello earth");
    browser.destroy();
  });

  it("preserves custom components, nested blocks, media, code, drawing and table spans", () => {
    const component = (type: string, children: NativeBlock[] = [], props: Record<string, unknown> = {}, value = ""): NativeBlock => ({ id: id(), type, props, content: value ? [run(value)] as NativeBlock["content"] : [], children });
    const blocks: NativeBlock[] = [
      component("group", [paragraph("nested")]),
      component("callout", [paragraph("body")], { tone: "warning", title: "careful" }, "inline"),
      component("card_group", [component("card", [paragraph()], { title: "card", href: "https://example.com" })], { columns: 2 }),
      component("steps", [component("step", [paragraph()], { title: "step" })]),
      component("tabs", [component("tab", [paragraph()], { title: "tab" })]),
      component("code_group", [component("code_block", [], { language: "go" }, "fmt.Println(1)")]),
      component("data_table", [], { table_id: null, table_version: null }),
      ...["image", "audio", "video", "file"].map(type => component(type, [], { source: { type: "external", url: "https://example.com/media" }, caption: type })),
      component("drawing", [], { source: null, scene: "", caption: "diagram" }),
      component("quote", [paragraph()], {}, "quote"),
      component("toggle_list_item", [paragraph()], {}, "toggle"),
      component("check_list_item", [paragraph()], { checked: true }, "done"),
      component("numbered_list_item", [], { start: 4 }, "four"),
      component("bullet_list_item", [], {}, "bullet"),
      component("heading", [], { level: 3 }, "heading"),
      component("divider"),
      { ...component("table"), table: { header_rows: 1, header_columns: 0, column_widths: [120, 240], rows: [[{ content: [run("header")] as NativeBlock["content"], row_span: 1, column_span: 2, alignment: "center", text_color: null, background_color: null }], [{ content: [], row_span: 1, column_span: 1, alignment: "left", text_color: null, background_color: null }, { content: [], row_span: 1, column_span: 1, alignment: "left", text_color: null, background_color: null }]] } },
    ];
    const initial = seed(blocks);
    assert.deepEqual(initial.blocks, blocks);
    const reread = transform({ state: initial.state, blocks: null, update: null });
    assert.deepEqual(reread.blocks, blocks);
  });

  it("converges splits and moves with independent edits and stable block IDs", () => {
    const a = paragraph("split here"), b = paragraph("keep"), c = paragraph("move");
    const initial = seed([a, b, c]);
    const browser = load(initial.state);
    text(browser, b.id).insert(4, " edited");
    const split = paragraph("here");
    const structure = transform({ state: initial.state, blocks: [c, { ...a, content: [run("split ")] as NativeBlock["content"] }, split, b], update: null });
    const merged = merge(structure.state, browser);
    assert.deepEqual(merged.blocks.map(block => block.id), [c.id, a.id, split.id, b.id]);
    assert.equal(content(merged.blocks[3]), "keep edited");
    browser.destroy();
  });

  it("undoes only local edits while retaining remote edits after synchronization", () => {
    const p = paragraph("base");
    const initial = seed([p]);
    const a = load(initial.state), b = load(initial.state);
    const origin = {};
    const undo = new Y.UndoManager(a.getXmlFragment("body"), { trackedOrigins: new Set([origin]) });
    a.transact(() => text(a, p.id).insert(4, " mine"), origin);
    text(b, p.id).insert(0, "remote ");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    undo.undo();
    const merged = merge(initial.state, a);
    assert.equal(content(merged.blocks[0]), "remote base");
    undo.destroy(); a.destroy(); b.destroy();
  });

  it("rejects malformed state, updates, unsupported schema and duplicate IDs", () => {
    assert.throws(() => transform({ state: "garbage", blocks: null, update: null }), EngineError);
    const p = paragraph(), initial = seed([p]);
    assert.throws(() => transform({ state: initial.state, blocks: null, update: "!!!!" }), EngineError);
    assert.throws(() => seed([p, p]), EngineError);
    const client = load(initial.state);
    client.getXmlFragment("body").insert(0, [new Y.XmlElement("script")]);
    assert.throws(() => merge(initial.state, client), EngineError);
    const other = load(initial.state);
    other.getMap("private-server-setting").set("x", true);
    assert.throws(() => merge(initial.state, other), EngineError);
    client.destroy(); other.destroy();
  });

  it("rejects missing causal dependencies until the client resends a complete update", () => {
    const p = paragraph(), initial = seed([p]), browser = load(initial.state);
    text(browser, p.id).insert(4, " first");
    const afterFirst = Y.encodeStateVector(browser);
    text(browser, p.id).insert(10, " second");
    const partial = encode(Y.encodeStateAsUpdate(browser, afterFirst));
    assert.throws(() => transform({ state: initial.state, blocks: null, update: partial }), (error: unknown) => error instanceof EngineError && error.code === "INVALID_UPDATE");
    assert.equal(content(merge(initial.state, browser).blocks[0]), "Base first second");
    browser.destroy();
  });

  it("rejects anonymous persisted blocks rather than assigning new IDs during projection", () => {
    const initial = seed([]), browser = load(initial.state);
    const anonymous = new Y.XmlElement("paragraph"), body = new Y.XmlText();
    body.insert(0, "anonymous"); anonymous.insert(0, [body]);
    browser.getXmlFragment("body").insert(0, [anonymous]);
    assert.throws(() => merge(initial.state, browser), (error: unknown) => error instanceof EngineError && error.code === "INVALID_CONTENT");
    browser.destroy();
  });

  it("projects and reconciles a 5,500 block document without replacing unchanged identities", { timeout: 15_000 }, () => {
    const blocks = Array.from({ length: 5500 }, (_, index) => paragraph(`block ${index}`));
    const initial = seed(blocks);
    assert.equal(initial.blocks.length, 5500);
    const same = transform({ state: initial.state, blocks, update: null });
    assert.equal(same.changed, false);
    assert.equal(same.state, initial.state);
  });
});

it("preserves an empty native document without inventing IDs on read", () => {
  const initial = seed([]);
  assert.deepEqual(initial.blocks, []);
  const read = transform({ state: initial.state, update: null, blocks: null });
  assert.deepEqual(read.blocks, []);
  assert.equal(read.state, initial.state);
});

it("rejects concurrent edits to a moved subtree so a draft can be recovered", () => {
  const a = paragraph("move me"), b = paragraph("keep"), c = paragraph("also keep");
  const initial = seed([a, b, c]);
  const browser = load(initial.state);
  text(browser, a.id).insert(7, " local draft");
  const moved = transform({ state: initial.state, blocks: [b, c, a], update: null });
  assert.throws(() => merge(moved.state, browser), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  assert.equal(text(browser, a.id).toString(), "move me local draft");
  browser.destroy();
});

it("rejects concurrent edits to a deleted subtree instead of silently acknowledging loss", () => {
  const a = paragraph("delete"), b = paragraph("keep");
  const initial = seed([a, b]);
  const browser = load(initial.state);
  text(browser, a.id).insert(6, " local draft");
  const removed = transform({ state: initial.state, blocks: [b], update: null });
  assert.throws(() => merge(removed.state, browser), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  browser.destroy();
});

it("checks original node targets before merging delete-only edits after a move", () => {
  const a = paragraph("move me"), b = paragraph("keep"), c = paragraph("also keep");
  const initial = seed([a, b, c]);
  const browser = load(initial.state), original = node(browser, a.id)._item!.id;
  const vector = Y.encodeStateVector(browser);
  text(browser, a.id).delete(0, 4);
  const update = encode(Y.encodeStateAsUpdate(browser, vector));
  const moved = transform({ state: initial.state, blocks: [b, c, a], update: null });
  assert.throws(() => transform({ state: moved.state, blocks: null, update, targets: [{ client: original.client, clock: original.clock }] }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  assert.equal(text(browser, a.id).toString(), " me");
  browser.destroy();
});

it("merges target-guarded deletes in a retained block and rejects malformed target IDs", () => {
  const p = paragraph("delete prefix"), initial = seed([p]), browser = load(initial.state);
  const original = node(browser, p.id)._item!.id;
  const vector = Y.encodeStateVector(browser);
  text(browser, p.id).delete(0, 7);
  const update = encode(Y.encodeStateAsUpdate(browser, vector));
  const result = transform({ state: initial.state, blocks: null, update, targets: [{ client: original.client, clock: original.clock }] });
  assert.equal(content(result.blocks[0]), "prefix");
  assert.throws(() => transform({ state: initial.state, blocks: null, update, targets: [{ client: -1, clock: 0 }] }), (error: unknown) => error instanceof EngineError && error.code === "INVALID_REQUEST");
  browser.destroy();
});

it("preserves native depth 31 and 32 and rejects depth 33", () => {
  const nested = (depth: number) => {
    let root = paragraph("leaf");
    for (let index = 1; index < depth; index++) root = { id: id(), type: "group", props: {}, content: [], children: [root] };
    return [root];
  };
  for (const depth of [31, 32]) {
    const blocks = nested(depth), initial = seed(blocks);
    assert.deepEqual(initial.blocks, blocks);
    const reloaded = transform({ state: initial.state, blocks: null, update: null });
    assert.deepEqual(reloaded.blocks, blocks);
  }
  assert.throws(() => seed(nested(33)), (error: unknown) => error instanceof EngineError && error.code === "INVALID_CONTENT");
});

it("fences a stale structural move after peer insertion or pure deletion commits first", () => {
  for (const peerEdit of ["insert", "delete"] as const) {
    const a = paragraph("move original"), b = paragraph("keep"), c = paragraph("also keep"), initial = seed([a, b, c]);
    const baseline = load(initial.state), original = node(baseline, a.id), item = original._item!.id;
    const targets = [{ client: item.client, clock: item.clock, content_hash: fingerprintElement(original) }];
    const move = transform({ state: initial.state, blocks: [b, c, a], update: null });
    const peer = load(initial.state);
    if (peerEdit === "insert") text(peer, a.id).insert(13, " peer");
    else text(peer, a.id).delete(0, 5);
    const current = merge(initial.state, peer);
    assert.throws(() => transform({ state: current.state, blocks: null, update: move.update, targets }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
    baseline.destroy(); peer.destroy();
  }
});

it("accepts a proven move, then rejects a stale peer update instead of losing it", () => {
  const a = paragraph("move original"), b = paragraph("keep"), c = paragraph("also keep"), initial = seed([a, b, c]);
  const baseline = load(initial.state), original = node(baseline, a.id), item = original._item!.id;
  const targets = [{ client: item.client, clock: item.clock, content_hash: fingerprintElement(original) }];
  const move = transform({ state: initial.state, blocks: [b, c, a], update: null });
  const moved = transform({ state: initial.state, blocks: null, update: move.update, targets });
  assert.deepEqual(moved.blocks.map(block => block.id), [b.id, c.id, a.id]);
  const peer = load(initial.state);
  text(peer, a.id).insert(13, " local draft");
  assert.throws(() => transform({ state: moved.state, blocks: null, update: encode(Y.encodeStateAsUpdate(peer)), targets: [{ client: item.client, clock: item.clock }] }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  assert.equal(text(peer, a.id).toString(), "move original local draft");
  baseline.destroy(); peer.destroy();
});

it("requires a content proof for whole-block deletion and preserves a newer peer edit", () => {
  const a = paragraph("remove"), b = paragraph("keep"), initial = seed([a, b]);
  const baseline = load(initial.state), original = node(baseline, a.id), item = original._item!.id;
  const targets = [{ client: item.client, clock: item.clock, content_hash: fingerprintElement(original) }];
  const removal = transform({ state: initial.state, blocks: [b], update: null });
  assert.throws(() => transform({ state: initial.state, blocks: null, update: removal.update }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  const accepted = transform({ state: initial.state, blocks: null, update: removal.update, targets });
  assert.deepEqual(accepted.blocks, [b]);
  const peer = load(initial.state); text(peer, a.id).insert(6, " peer");
  const current = merge(initial.state, peer);
  assert.throws(() => transform({ state: current.state, blocks: null, update: removal.update, targets }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  baseline.destroy(); peer.destroy();
});

it("preserves concurrent atomic drawing drafts in both delivery orders", () => {
  const drawing: NativeBlock = { id: id(), type: "drawing", props: { source: null, scene: "", caption: "canvas" }, content: [], children: [] };
  const initial = seed([drawing]);
  const first = load(initial.state), second = load(initial.state), original = node(first, drawing.id), item = original._item!.id;
  const target = { client: item.client, clock: item.clock, content_hash: fingerprintElement(original) };
  const firstNode = node(first, drawing.id), secondNode = node(second, drawing.id);
  firstNode.setAttribute("orbisProps", { ...(firstNode.getAttribute("orbisProps") as unknown as Record<string, unknown>), scene: "first authored scene" } as unknown as string);
  secondNode.setAttribute("orbisProps", { ...(secondNode.getAttribute("orbisProps") as unknown as Record<string, unknown>), scene: "second authored scene" } as unknown as string);
  const updates = [encode(Y.encodeStateAsUpdate(first)), encode(Y.encodeStateAsUpdate(second))];
  for (const order of [[0, 1], [1, 0]]) {
    const accepted = transform({ state: initial.state, blocks: null, update: updates[order[0]], targets: [target] });
    assert.throws(() => transform({ state: accepted.state, blocks: null, update: updates[order[1]], targets: [target] }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
    assert.equal((node(order[1] === 0 ? first : second, drawing.id).getAttribute("orbisProps") as unknown as Record<string, unknown>).scene, order[1] === 0 ? "first authored scene" : "second authored scene");
  }
  first.destroy(); second.destroy();
});

it("requires an atomic drawing proof and accepts sequential drawing updates", () => {
  const drawing: NativeBlock = { id: id(), type: "drawing", props: { source: null, scene: "", caption: "canvas" }, content: [], children: [] };
  let stored = seed([drawing]);
  for (const scene of ["one authored scene", "two authored scenes"]) {
    const browser = load(stored.state), original = node(browser, drawing.id), item = original._item!.id;
    const target = { client: item.client, clock: item.clock, content_hash: fingerprintElement(original) };
    original.setAttribute("orbisProps", { ...(original.getAttribute("orbisProps") as unknown as Record<string, unknown>), scene } as unknown as string);
    const update = encode(Y.encodeStateAsUpdate(browser));
    assert.throws(() => transform({ state: stored.state, blocks: null, update }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
    stored = transform({ state: stored.state, blocks: null, update, targets: [target] });
    assert.equal(stored.blocks[0].props.scene, scene);
    browser.destroy();
  }
});

it("keeps initialized data-table IDs and versions after native API synchronization", () => {
  const reference: NativeBlock = { id: id(), type: "data_table", props: { table_id: null, table_version: null }, content: [], children: [] };
  const p = paragraph("text"), initial = seed([reference, p]);
  const tableID = id();
  const initialized: NativeBlock = { ...reference, props: { table_id: tableID, table_version: 1 } };
  const synced = transform({ state: initial.state, blocks: [initialized, p], update: null });
  assert.deepEqual(synced.blocks[0], initialized);
  const peer = load(initial.state); text(peer, p.id).insert(4, " peer");
  const merged = merge(synced.state, peer);
  assert.deepEqual(merged.blocks[0], initialized);
  const restored = load(merged.state), editorNode = node(restored, reference.id);
  assert.deepEqual(editorNode.getAttribute("orbisProps"), { table_id: tableID, table_revision: 1 });
  peer.destroy(); restored.destroy();
});

it("protects a retained container's own text when a stale type conversion replaces its head", () => {
  const parent = { ...paragraph("Own body"), children: [paragraph("nested")] }, initial = seed([parent]);
  const baseline = load(initial.state), outer = node(baseline, parent.id), head = outer.get(0) as Y.XmlElement;
  const targets = [outer, head].map(element => ({ client: element._item!.id.client, clock: element._item!.id.clock, content_hash: fingerprintElement(element) }));
  const heading: NativeBlock = { ...parent, type: "heading", props: { level: 2 } };
  const conversion = transform({ state: initial.state, blocks: [heading], update: null });
  const valid = transform({ state: initial.state, blocks: null, update: conversion.update, targets });
  assert.equal(valid.blocks[0].type, "heading");
  const peer = load(initial.state), peerHead = node(peer, parent.id).get(0) as Y.XmlElement;
  (peerHead.get(0) as Y.XmlText).insert(8, " peer edit");
  const current = merge(initial.state, peer);
  assert.throws(() => transform({ state: current.state, blocks: null, update: conversion.update, targets }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  baseline.destroy(); peer.destroy();
});

it("preserves formatted code runs, links, colors and omitted language without source-text caches", () => {
  const code: NativeBlock = { id: id(), type: "code_block", props: {}, content: [
    { text: "const ", marks: ["bold"], href: null, text_color: "red" },
    { text: "name", marks: ["italic"], href: "https://example.com/code", background_color: "yellow" },
    { text: "\n", marks: [], href: null },
    { text: "", marks: [], href: null },
  ], children: [] };
  const initial = seed([code]);
  assert.deepEqual(initial.blocks, [code]);
  const browser = load(initial.state), element = node(browser, code.id);
  for (const name of ["orbisOriginal", "orbisSignature", "orbisCellOriginal"]) assert.equal(element.getAttribute(name), undefined);
  const format = element.getAttribute("orbisCodeFormat") as unknown as { hash: string; runs: unknown[] };
  assert.equal(format.hash.length, 64);
  assert.ok(!JSON.stringify(format).includes("const "));
  assert.deepEqual(transform({ state: initial.state, blocks: null, update: null }).blocks, [code]);
  text(browser, code.id).insert(0, "changed ");
  const edited = merge(initial.state, browser);
  assert.equal(content(edited.blocks[0]), "changed const name\n");
  assert.ok(edited.blocks[0].content.every(value => value.marks.length === 0 && value.href === null));
  assert.deepEqual(edited.blocks[0].props, {});
  browser.destroy();
});

it("preserves explicit numbered-list defaults and continuous start overrides", () => {
  const item = (start?: number): NativeBlock => ({ ...paragraph("item"), type: "numbered_list_item", props: start === undefined ? {} : { start } });
  for (const blocks of [[item(1), item(2), item()], [item(7), item(8), item()]]) assert.deepEqual(seed(blocks).blocks, blocks);
});

it("seeds and reloads a legal deep large document with binary size linear in native bytes", { timeout: 30_000 }, () => {
  let root = paragraph("x".repeat(6 * 1024 * 1024));
  for (let depth = 1; depth < 32; depth++) root = { id: id(), type: "group", props: {}, content: [], children: [root] };
  const blocks = [root], nativeBytes = Buffer.byteLength(JSON.stringify(blocks));
  const initial = seed(blocks);
  assert.deepEqual(initial.blocks, blocks);
  assert.ok(bytes(initial.state).length < nativeBytes * 1.1 + 64_000);
  const reloaded = transform({ state: initial.state, blocks: null, update: null });
  assert.equal(reloaded.state, initial.state);
  assert.deepEqual(reloaded.blocks, blocks);
});

it("accepts legacy cache attributes while never using cached content as authority", () => {
  const p = paragraph("actual body"), initial = seed([p]), browser = load(initial.state);
  node(browser, p.id).setAttribute("orbisOriginal", { id: p.id, type: "paragraph", props: {}, content: [{ type: "text", text: "forged cached body" }], children: [] } as unknown as string);
  node(browser, p.id).setAttribute("orbisSignature", "forged");
  assert.deepEqual(merge(initial.state, browser).blocks, [p]);
  browser.destroy();
});

it("preserves optional media properties and source-only media without adding captions", () => {
  const source = { type: "external", url: "https://example.com/media" };
  const blocks: NativeBlock[] = [
    { id: id(), type: "image", props: { source, alt: "alternative", width: 640, height: 480, show_preview: false }, content: [], children: [] },
    { id: id(), type: "video", props: { source, name: "clip.mp4" }, content: [], children: [] },
    { id: id(), type: "audio", props: { source: null }, content: [], children: [] },
    { id: id(), type: "file", props: { source }, content: [], children: [] },
  ];
  assert.deepEqual(seed(blocks).blocks, blocks);
});

it("preserves accepted empty native tables without inventing rows or column widths", () => {
  for (const widths of [[], [120, null, 240]]) {
    const table: NativeBlock = { id: id(), type: "table", props: {}, content: [], children: [], table: { rows: [], column_widths: widths, header_rows: 0, header_columns: 0 } };
    const initial = seed([table]);
    assert.deepEqual(initial.blocks, [table]);
    assert.deepEqual(transform({ state: initial.state, blocks: null, update: null }).blocks, [table]);
  }
});

it("preserves all accepted combinations of native inline marks", () => {
  const marks = ["bold", "italic", "underline", "strike", "code"];
  for (let mask = 0; mask < 1 << marks.length; mask++) {
    const chosen = marks.filter((_value, bit) => mask & (1 << bit));
    const p: NativeBlock = { id: id(), type: "paragraph", props: {}, content: [{ text: "styled", marks: chosen as NativeBlock["content"][number]["marks"], href: null }], children: [] };
    assert.deepEqual(seed([p]).blocks, [p]);
  }
});

it("deletes a full-budget document with more targets than native blocks while guarding own heads", { timeout: 30_000 }, () => {
  const blocks = Array.from({ length: 5000 }, () => ({ ...paragraph("parent"), children: [paragraph("child")] }));
  const initial = seed(blocks), browser = load(initial.state), targets: Array<{ client: number; clock: number; content_hash: string }> = [];
  const visit = (fragment: Y.XmlFragment) => {
    for (const element of fragment.toArray()) if (element instanceof Y.XmlElement) {
      if (element.getAttribute("orbisId") && element._item) targets.push({ client: element._item.id.client, clock: element._item.id.clock, content_hash: fingerprintElement(element) });
      visit(element);
    }
  };
  visit(browser.getXmlFragment("body"));
  assert.equal(targets.length, 15000);
  const vector = Y.encodeStateVector(browser);
  browser.getXmlFragment("body").delete(0, browser.getXmlFragment("body").length);
  const result = transform({ state: initial.state, blocks: null, update: encode(Y.encodeStateAsUpdate(browser, vector)), targets });
  assert.deepEqual(result.blocks, []);
  browser.destroy();
});

it("preserves competing component property objects in both delivery orders", () => {
  const callout: NativeBlock = { id: id(), type: "callout", props: { title: "original", tone: "info" }, content: [run("body")] as NativeBlock["content"], children: [] };
  const initial = seed([callout]), a = load(initial.state), b = load(initial.state), original = node(a, callout.id), item = original._item!.id;
  const targets = [{ client: item.client, clock: item.clock, content_hash: fingerprintElement(original) }];
  node(a, callout.id).setAttribute("orbisProps", { title: "new title", tone: "info" } as unknown as string);
  node(b, callout.id).setAttribute("orbisProps", { title: "original", tone: "warning" } as unknown as string);
  const updates = [encode(Y.encodeStateAsUpdate(a)), encode(Y.encodeStateAsUpdate(b))];
  for (const order of [[0, 1], [1, 0]]) {
    const first = transform({ state: initial.state, blocks: null, update: updates[order[0]], targets });
    assert.throws(() => transform({ state: first.state, blocks: null, update: updates[order[1]], targets }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  }
  a.destroy(); b.destroy();
});

it("merges ordinary body edits after properties commit and fences a stale property snapshot after body edits", () => {
  const callout: NativeBlock = { id: id(), type: "callout", props: { title: "original", tone: "info" }, content: [run("body")] as NativeBlock["content"], children: [] };
  const initial = seed([callout]), properties = load(initial.state), body = load(initial.state), original = node(properties, callout.id), item = original._item!.id;
  const targets = [{ client: item.client, clock: item.clock, content_hash: fingerprintElement(original) }];
  node(properties, callout.id).setAttribute("orbisProps", { title: "new title", tone: "info" } as unknown as string);
  const paragraph = node(body, callout.id).get(0) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(4, " peer");
  const update = encode(Y.encodeStateAsUpdate(properties));
  const first = transform({ state: initial.state, blocks: null, update, targets });
  const merged = merge(first.state, body);
  assert.equal(merged.blocks[0].props.title, "new title");
  assert.equal(content(merged.blocks[0]), "body peer");
  const bodyFirst = merge(initial.state, body);
  assert.throws(() => transform({ state: bodyFirst.state, blocks: null, update, targets }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
  properties.destroy(); body.destroy();
});

it("protects table-cell property objects and width arrays through the owning table proof", () => {
  const cell = { content: [run("cell")] as NativeBlock["content"], row_span: 1, column_span: 2, alignment: "left", text_color: null, background_color: null };
  for (const name of ["orbisCellProps", "columnWidths", "colwidth"]) {
    const table: NativeBlock = { id: id(), type: "table", props: {}, content: [], children: [], table: { rows: name === "columnWidths" ? [] : [[cell]], column_widths: [100, 200], header_rows: 0, header_columns: 0 } };
    const initial = seed([table]), a = load(initial.state), b = load(initial.state), original = node(a, table.id), item = original._item!.id;
    const targets = [{ client: item.client, clock: item.clock, content_hash: fingerprintElement(original) }];
    const mutate = (doc: Y.Doc, first: boolean) => {
      const root = node(doc, table.id), target = name === "columnWidths" ? root : (root.get(0) as Y.XmlElement).get(0) as Y.XmlElement;
      const value = name === "orbisCellProps" ? { ...(target.getAttribute(name) as unknown as Record<string, unknown>), ...(first ? { textAlignment: "center" } : { backgroundColor: "red" }) } : first ? [150, 200] : [100, 260];
      target.setAttribute(name, value as unknown as string);
    };
    mutate(a, true); mutate(b, false);
    const updates = [encode(Y.encodeStateAsUpdate(a)), encode(Y.encodeStateAsUpdate(b))];
    assert.throws(() => transform({ state: initial.state, blocks: null, update: updates[0] }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
    for (const order of [[0, 1], [1, 0]]) {
      const first = transform({ state: initial.state, blocks: null, update: updates[order[0]], targets });
      assert.throws(() => transform({ state: first.state, blocks: null, update: updates[order[1]], targets }), (error: unknown) => error instanceof EngineError && error.code === "EDIT_TARGET_REMOVED");
    }
    a.destroy(); b.destroy();
  }
});
