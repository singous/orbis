import { expect, it } from "vitest";
import { copyRecordCells, duplicateRecord, pasteRecordCells } from "./record-actions";
import { newField, type Row } from "./model";
const text = newField("text");
const system = newField("created_at");
const row = { id: "row", version: 3, values: { [text.id]: "A\tB\nC", [system.id]: 1000 } } as Row;
it("round-trips quoted cell text and preserves observed row versions", () => {
  const copied = copyRecordCells([row], [text]);
  expect(pasteRecordCells(copied, [row], [text])).toEqual([{ id: row.id, version: 3, values: { [text.id]: row.values[text.id] } }]);
});
it("validates the entire paste before creating any writes", () => {
  expect(() => pasteRecordCells("one\ttwo", [row], [text])).toThrow("字段范围");
  expect(() => pasteRecordCells("A", [row], [system])).toThrow();
  expect(() => pasteRecordCells(Array(201).fill("A").join("\n"), [], [text])).toThrow("200");
});
it("duplicates only editable values and retains relative placement intent", () => {
  const copy = duplicateRecord(row, [text, system], true);
  expect(copy.id).not.toBe(row.id);
  expect(copy).toMatchObject({ version: 0, after_id: row.id, values: { [text.id]: row.values[text.id] } });
  expect(copy.values).not.toHaveProperty(system.id);
  expect(duplicateRecord(row, [text], false)).not.toHaveProperty("after_id");
});
