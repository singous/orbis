import { z } from "zod";
import { recordSchema, valueSchema, type Row, type Value } from "./model";

const schema = z.object({
  row: recordSchema,
  fieldId: z.string(),
  value: valueSchema,
});
export type CellDraft = z.infer<typeof schema>;

export function readCellDraft(key: string): CellDraft | null {
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function storeCellDraft(
  key: string,
  row: Row,
  fieldId: string,
  value: Value,
) {
  const previous = readCellDraft(key);
  const base =
    previous?.row.id === row.id &&
    previous.fieldId === fieldId &&
    previous.row.version > row.version
      ? previous.row
      : row;
  const draft: CellDraft = {
    row: { ...base, values: { [fieldId]: base.values[fieldId] ?? null } },
    fieldId,
    value,
  };
  const serialized = JSON.stringify(draft);
  if (sessionStorage.getItem(key) !== serialized)
    sessionStorage.setItem(key, serialized);
}

export function acknowledgeCellDraft(key: string, records: Row[]) {
  const saved = readCellDraft(key);
  if (!saved) return;
  const row = records.find((item) => item.id === saved.row.id);
  if (!row || row.version < saved.row.version) return;
  if (
    JSON.stringify(row.values[saved.fieldId] ?? null) ===
    JSON.stringify(saved.value)
  )
    clearCellDraft(key, saved.row.id, saved.fieldId, saved.value);
  else storeCellDraft(key, row, saved.fieldId, saved.value);
}

export function clearCellDraft(
  key: string,
  rowId: string,
  fieldId: string,
  value: Value,
) {
  const saved = readCellDraft(key);
  if (
    saved?.row.id === rowId &&
    saved.fieldId === fieldId &&
    JSON.stringify(saved.value) === JSON.stringify(value)
  )
    sessionStorage.removeItem(key);
}
