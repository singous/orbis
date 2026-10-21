import { describe, expect, it } from "vitest";
import { createBlockChanges } from "./block-changes";
import type { NoteBlocksV2, OrbisBlock } from "../../content/model/blocks";

const paragraph = (id: string, children: OrbisBlock[] = []): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: id }], children });
const document = (blocks: OrbisBlock[]): NoteBlocksV2 => ({ schema_version: 2, editor: "blocknote", blocks });

describe("block change transport", () => {
  it("sends only one shallow block for a body edit in a long loaded document", () => {
    const blocks = Array.from({ length: 1024 }, (_, index) => paragraph(`block-${index}`));
    const current = [...blocks];
    current[500] = { ...current[500], content: [{ type: "text", text: "An edit" }] };
    const changes = createBlockChanges()(document(blocks), document(current));
    expect(changes.upserts).toHaveLength(1);
    expect(changes.upserts[0].id).toBe("block-500");
    expect(changes.upserts[0]).not.toHaveProperty("children");
    expect(changes.moves).toEqual([]);
    expect(changes.deletes).toEqual([]);
  });
  it("loading the same tail into both baselines produces no changes", () => {
    const first = [paragraph("first")], tail = [paragraph("later")];
    expect(createBlockChanges()(document([...first, ...tail]), document([...first, ...tail]))).toEqual({ upserts: [], moves: [], deletes: [] });
  });
  it("moves a nested child out of a removed parent without copying its body", () => {
    const child = paragraph("child"), parent = paragraph("parent", [child]);
    expect(createBlockChanges()(document([parent]), document([child]))).toEqual({ upserts: [], moves: [{ id: "child", parent_id: null, after_id: null }], deletes: ["parent"] });
  });
});
