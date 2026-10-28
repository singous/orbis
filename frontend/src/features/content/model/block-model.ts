import { newUUID } from "../../../shared/ids";
import type { NoteBlocks } from "../../../shared/api/schemas";

export type OrbisInlineStyle = Partial<
  Record<"bold" | "italic" | "underline" | "strike" | "code", true>
> & { textColor?: string; backgroundColor?: string };

export type OrbisInline =
  | { type: "text"; text: string; styles?: OrbisInlineStyle }
  | { type: "link"; href: string; content: OrbisInline[] | string };

export type OrbisTableCell =
  | string
  | OrbisInline[]
  | { type: "tableCell"; props?: Record<string, unknown>; content?: OrbisInline[] | string };

export type OrbisTableContent = {
  type: "tableContent";
  rows: Array<{ cells: OrbisTableCell[] }>;
  columnWidths?: Array<number | null>;
  headerRows?: number;
  headerCols?: number;
};

export type OrbisBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: OrbisInline[] | string | OrbisTableContent;
  children: OrbisBlock[];
};

export type NoteBlocksV2 = {
  schema_version: 2;
  editor: "blocknote";
  blocks: OrbisBlock[];
};

export function newBlockId(): string { return newUUID(); }

export function createEmptyV2(): NoteBlocksV2 {
  return {
    schema_version: 2,
    editor: "blocknote",
    blocks: [{ id: newBlockId(), type: "paragraph", props: {}, content: [], children: [] }],
  };
}

export function isV2(blocks: NoteBlocks | NoteBlocksV2 | null | undefined): blocks is NoteBlocksV2 {
  return Boolean(blocks) && (blocks as NoteBlocksV2).schema_version === 2;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

/**
 * Key-order-insensitive JSON for block content. Postgres JSONB reorders
 * object keys, so a server round-trip returns semantically identical blocks
 * whose JSON string differs from the live editor document's. Compare with
 * this instead of JSON.stringify when deciding whether content changed.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
