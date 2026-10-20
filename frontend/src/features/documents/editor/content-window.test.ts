import { expect, it } from "vitest";
import { appendChildBlocks, hydrateBlockPayload, mergeLoadDescriptors } from "./content-window";
import { createBlockChanges } from "./block-changes";
import type { NoteBlocksV2, OrbisBlock } from "../../content/model/blocks";

const paragraph = (id: string, text = id): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });
const document = (blocks: OrbisBlock[]): NoteBlocksV2 => ({ schema_version: 2, editor: "blocknote", blocks });

it("extends both partial baselines without turning missing descendants into deletions", () => {
  const parent = { ...paragraph("parent"), type: "group" };
  const untouched = paragraph("tail");
  const saved = document([parent, untouched]);
  const current = document([parent, { ...untouched, content: [{ type: "text", text: "edited" }] }]);
  const incoming = [paragraph("child-a"), paragraph("child-b")];
  const extendedSaved = appendChildBlocks(saved, "parent", incoming);
  const extendedCurrent = appendChildBlocks(current, "parent", incoming);
  expect(extendedSaved.blocks[1]).toBe(untouched);
  expect(createBlockChanges()(extendedSaved, extendedCurrent)).toEqual({ upserts: [{ id: "tail", type: "paragraph", props: {}, content: [{ type: "text", text: "edited" }] }], moves: [], deletes: [] });
  expect(createBlockChanges()(extendedSaved, appendChildBlocks(extendedSaved, "parent", incoming))).toEqual({ upserts: [], moves: [], deletes: [] });
});

it("hydrates the body while preserving independently loaded children", () => {
  const child = paragraph("child");
  const saved = document([{ ...paragraph("big"), children: [child] }, paragraph("sibling")]);
  const result = hydrateBlockPayload(saved, { ...paragraph("big", "full body"), props: { custom: "kept" } });
  expect(result.blocks[0].children[0]).toBe(child);
  expect(result.blocks[1]).toBe(saved.blocks[1]);
  expect(result.blocks[0].props.custom).toBe("kept");
  expect(() => hydrateBlockPayload(saved, paragraph("missing"))).toThrow("目标内容");
});

it("keeps explicit hydration progress when sibling descriptions are read again", () => {
  const descriptor = { id: "parent", parent_id: null, child_count: 1000, has_children: true, children_loaded: false, payload_loaded: false, payload_bytes: 200000 };
  const states = mergeLoadDescriptors(new Map(), [descriptor]);
  states.set("parent", { ...states.get("parent")!, cursor: "opaque-next",loaded_count:32, payload_loaded: true });
  const merged = mergeLoadDescriptors(states, [descriptor]);
  expect(merged.get("parent")).toMatchObject({ cursor: "opaque-next",loaded_count:32, payload_loaded: true, children_loaded: false });
});
