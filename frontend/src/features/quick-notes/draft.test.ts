import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey, freshDraft, hasNoteContent, pendingWrite, readDraft, writeDraft } from "./draft";
import type { NativeBlock } from "../content/codecs/api-content";

const block: NativeBlock = { id: "00000000-0000-4000-8000-000000000001", type: "paragraph", props: {}, content: [{ text: "A private thought", marks: [], href: null }], children: [] };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe("quick note recovery", () => {
  it("preserves the exact uncertain request across refresh", () => {
    const key = draftKey("alice", "work");
    const draft = { ...freshDraft(), blocks: [block] };
    const pending = pendingWrite(draft);
    expect(writeDraft(key, { ...draft, pending })).toBe(true);
    const restored = readDraft(key, freshDraft());
    expect(pendingWrite(restored)).toEqual(pending);
    expect(readDraft(draftKey("bob", "work"), freshDraft()).blocks).toEqual([]);
    expect(readDraft(draftKey("alice", "other"), freshDraft()).blocks).toEqual([]);
  });
  it("does not treat inaccessible storage as a saved draft", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(writeDraft("draft", { ...freshDraft(), blocks: [block] })).toBe(false);
  });
  it("ignores malformed drafts without breaking capture", () => {
    localStorage.setItem("broken", "{broken");
    expect(readDraft("broken", freshDraft())).toEqual(freshDraft());
    localStorage.setItem("broken", JSON.stringify({ ...freshDraft(), blocks: [{ type: "mystery" }] }));
    expect(readDraft("broken", freshDraft()).blocks).toEqual([]);
  });
  it("accepts an attachment-only capture but not formatting-only text", () => {
    expect(hasNoteContent([{ ...block, content: [{ text: " \n", marks: ["bold"], href: null }] }])).toBe(false);
    expect(hasNoteContent([{ ...block, type: "file", content: [], props: { source: { type: "asset", asset_id: block.id } } }])).toBe(true);
  });
});
