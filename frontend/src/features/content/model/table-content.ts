import type { OrbisBlock, OrbisTableCell, OrbisTableContent } from "./block-model";

export type LegacyTableContent = OrbisTableCell[][];

export function isLegacyTableContent(content: unknown): content is LegacyTableContent {
  return Array.isArray(content) && content.length > 0 && content.every(Array.isArray);
}

/** Keep stored empty tables valid for BlockNote's nonempty table/row schema. */
export function editableTableContent(content: OrbisBlock["content"] | LegacyTableContent): OrbisTableContent {
  if (isLegacyTableContent(content)) {
    return editableTableContent({ type: "tableContent", rows: content.map((cells) => ({ cells })) });
  }
  if (typeof content === "string" || Array.isArray(content)) {
    return { type: "tableContent", rows: [{ cells: [content.length ? content : ""] }] };
  }
  if (content.rows.length && content.rows.every((row) => row.cells.length)) return content;
  return {
    ...content,
    rows: content.rows.length
      ? content.rows.map((row) => row.cells.length ? row : { ...row, cells: [""] })
      : [{ cells: [""] }],
  };
}
