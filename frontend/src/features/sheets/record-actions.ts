import { newUUID } from "../../shared/ids";
import { cellText, KINDS, MAX_BATCH, parseCell, type Field, type Patch, type Row } from "./model";
import { decodeCells, encodeCells } from "./clipboard";

export function copyRecordCells(rows: Row[], fields: Field[]): string {
  return encodeCells(rows.map(row => fields.map(field => cellText(field, row.values[field.id]))));
}
export function pasteRecordCells(text: string, rows: Row[], fields: Field[]): Patch[] {
  const data = decodeCells(text);
  if (data.length > MAX_BATCH) throw new Error(`每次最多粘贴 ${MAX_BATCH} 行`);
  return data.map((values, index) => ({ id: rows[index]?.id ?? newUUID(), version: rows[index]?.version ?? 0,
    values: Object.fromEntries(values.map((value, col) => {
      const field = fields[col];
      if (!field) throw new Error("粘贴内容超出字段范围");
      return [field.id, parseCell(field, value)];
    })) }));
}
export function duplicateRecord(row: Row, fields: Field[], relative: boolean): Patch {
  return { id: newUUID(), version: 0, ...(relative ? { after_id: row.id } : {}),
    values: Object.fromEntries(fields.filter(field => !KINDS[field.kind].system).map(field => [field.id, structuredClone(row.values[field.id] ?? null)])) };
}
