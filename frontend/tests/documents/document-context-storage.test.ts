import { afterEach, describe, expect, it, vi } from "vitest";
import { readDocumentContextOpen, writeDocumentContextOpen } from "../../src/features/documents/document-context-state";

afterEach(() => vi.restoreAllMocks());

describe("document context preferences when browser storage is unavailable", () => {
  it("keeps the document openable when reading its panel preference is blocked", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    expect(readDocumentContextOpen("workspace-1")).toBe(true);
  });

  it("does not interrupt panel toggling when saving the preference fails", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is full", "QuotaExceededError");
    });
    expect(() => writeDocumentContextOpen("workspace-1", false)).not.toThrow();
  });
});
