import { beforeEach, expect, it } from "vitest";
import {
  acknowledgeCellDraft,
  clearCellDraft,
  readCellDraft,
  storeCellDraft,
} from "./cell-draft";
import type { Row } from "./model";
const key = "test:cell-draft";
const row: Row = {
  id: "row",
  version: 1,
  position: 1,
  values: { text: "original", other: "unrelated" },
  created_at_ms: 1,
  updated_at_ms: 1,
  created_by: null,
  updated_by: null,
};
beforeEach(() => sessionStorage.clear());
it("restores the edited cell without retaining unrelated record values", () => {
  storeCellDraft(key, row, "text", "draft");
  expect(readCellDraft(key)?.value).toBe("draft");
  expect(readCellDraft(key)?.row.values).toEqual({ text: "original" });
});
it("advances an acknowledged base before clearing its operation without losing newer typing", () => {
  storeCellDraft(key, row, "text", "newer draft");
  acknowledgeCellDraft(key, [
    { ...row, version: 2, values: { text: "first save" } },
  ]);
  expect(readCellDraft(key)?.row.version).toBe(2);
  storeCellDraft(key, row, "text", "still typing");
  expect(readCellDraft(key)?.row.version).toBe(2);
  expect(readCellDraft(key)?.value).toBe("still typing");
  clearCellDraft(key, row.id, "text", "first save");
  expect(readCellDraft(key)?.value).toBe("still typing");
  acknowledgeCellDraft(key, [
    { ...row, version: 3, values: { text: "still typing" } },
  ]);
  expect(readCellDraft(key)).toBeNull();
});
it("does not clear another cell's draft when an older save completes", () => {
  storeCellDraft(key, row, "text", "pending");
  acknowledgeCellDraft(key, [
    { ...row, id: "another", version: 2, values: { text: "pending" } },
  ]);
  expect(readCellDraft(key)?.value).toBe("pending");
});
