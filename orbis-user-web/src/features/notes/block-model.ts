/**
 * Orbis normalized block model (schema_version 2).
 *
 * The block shape intentionally mirrors BlockNote's `Block`
 * ({ id, type, props, content, children }) so the editor can read/write it
 * without lossy conversion, while remaining an Orbis-owned, editor-agnostic
 * contract per PRD-R010 (storage must not bind to an editor's runtime state).
 */
import type { JSONContent } from "@tiptap/react";

import type { NoteBlocks } from "../../shared/api/schemas";
import { documentBlockMarkdown, documentBlockTitle } from "../content/document-components";

export type OrbisInlineStyle = Partial<
  Record<"bold" | "italic" | "underline" | "strike" | "code", true>
>;

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

type LegacyTableContent = OrbisTableCell[][];

function isLegacyTableContent(content: unknown): content is LegacyTableContent {
  return Array.isArray(content) && content.length > 0 && content.every(Array.isArray);
}

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

export function newBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

const STYLE_MARKS = ["bold", "italic", "underline", "strike", "code"] as const;

function inlineFromTiptap(nodes: JSONContent[] | undefined): OrbisInline[] {
  const result: OrbisInline[] = [];
  for (const node of nodes ?? []) {
    if (node.type !== "text") continue;
    const styles: OrbisInlineStyle = {};
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") {
        href = (mark.attrs as { href?: string } | undefined)?.href;
      } else if ((STYLE_MARKS as readonly string[]).includes(mark.type)) {
        styles[mark.type as (typeof STYLE_MARKS)[number]] = true;
      }
    }
    const text = node.text ?? "";
    if (href) {
      result.push({ type: "link", href, content: [{ type: "text", text, styles }] });
    } else {
      result.push({ type: "text", text, styles });
    }
  }
  return result;
}

function blockBase(type: string, props: Record<string, unknown> = {}): OrbisBlock {
  return { id: newBlockId(), type, props, content: [], children: [] };
}

/** Convert a tiptap list node (bulletList/orderedList/taskList) into flat-ish blocks with nesting. */
function listToBlocks(listType: "bulletListItem" | "numberedListItem" | "checkListItem", node: JSONContent): OrbisBlock[] {
  const items: OrbisBlock[] = [];
  for (const item of node.content ?? []) {
    const isTask = listType === "checkListItem";
    const block = blockBase(listType, isTask ? { checked: Boolean((item.attrs as { checked?: boolean } | undefined)?.checked) } : {});
    if (listType === "numberedListItem" && items.length === 0) {
      block.props.start = Number.isInteger(node.attrs?.start) ? node.attrs!.start : 1;
    }
    const [first, ...rest] = item.content ?? [];
    if (first && first.type === "paragraph") {
      block.content = inlineFromTiptap(first.content);
    }
    block.children = rest.flatMap((child) => nodeToBlocks(child));
    items.push(block);
  }
  return items;
}

/** Recursively convert a tiptap node into Orbis blocks. */
export function nodeToBlocks(node: JSONContent): OrbisBlock[] {
  switch (node.type) {
    case "paragraph":
      return [{ ...blockBase("paragraph"), content: inlineFromTiptap(node.content) }];
    case "heading": {
      const level = (node.attrs as { level?: number } | undefined)?.level ?? 1;
      return [{ ...blockBase("heading", { level }), content: inlineFromTiptap(node.content) }];
    }
    case "bulletList":
      return listToBlocks("bulletListItem", node);
    case "orderedList":
      return listToBlocks("numberedListItem", node);
    case "taskList":
      return listToBlocks("checkListItem", node);
    case "blockquote": {
      const quote = blockBase("quote");
      quote.children = (node.content ?? []).flatMap((child) => nodeToBlocks(child));
      return [quote];
    }
    case "codeBlock": {
      const language = (node.attrs as { language?: string | null } | undefined)?.language ?? "none";
      const text = (node.content ?? [])
        .map((child) => child.text ?? "")
        .join("");
      return [{ ...blockBase("codeBlock", { language }), content: text }];
    }
    case "horizontalRule":
      return [blockBase("divider")];
    case "table":
      return [{ ...blockBase("table"), content: editableTableContent(tableFromTiptap(node)) }];
    default:
      // Unknown node: flatten any text content into a paragraph.
      return [{ ...blockBase("paragraph"), content: inlineFromTiptap(node.content) }];
  }
}

/** Table cells hold inline content; keep block boundaries and list labels as text. */
function cellInlineFromTiptap(node: JSONContent): OrbisInline[] {
  if (node.type === "paragraph" || node.type === "heading") {
    return inlineFromTiptap(node.content);
  }
  const result: OrbisInline[] = [];
  for (const [index, child] of (node.content ?? []).entries()) {
    if (index) result.push({ type: "text", text: "\n" });
    if (node.type === "bulletList" || node.type === "orderedList") {
      const start = Number.isInteger(node.attrs?.start) ? Number(node.attrs!.start) : 1;
      result.push({ type: "text", text: node.type === "bulletList" ? "- " : `${index + start}. ` });
    }
    result.push(...cellInlineFromTiptap(child));
  }
  return result;
}

function tableFromTiptap(node: JSONContent): OrbisTableContent {
  const rows = node.content ?? [];
  let headerRows = 0;
  for (const row of rows) {
    if (!row.content?.length || !row.content.every((cell) => cell.type === "tableHeader")) break;
    headerRows++;
  }
  const headerCols = rows.length ? Math.min(...rows.map((row) => {
    let count = 0;
    for (const cell of row.content ?? []) {
      if (cell.type !== "tableHeader") break;
      count += Number(cell.attrs?.colspan ?? 1);
    }
    return count;
  })) : 0;
  const columnWidths = (rows[0]?.content ?? []).flatMap((cell) => {
    const widths = cell.attrs?.colwidth as Array<number | null> | undefined;
    const colspan = Number(cell.attrs?.colspan ?? 1);
    return Array.from({ length: colspan }, (_, index) => widths?.[index] ?? null);
  });
  return {
    type: "tableContent",
    columnWidths,
    headerRows,
    headerCols,
    rows: rows.map((row) => ({
      cells: (row.content ?? []).map((cell) => ({
        type: "tableCell",
        props: {
          colspan: cell.attrs?.colspan ?? 1,
          rowspan: cell.attrs?.rowspan ?? 1,
        },
        content: cellInlineFromTiptap(cell),
      })),
    })),
  };
}

/** Convert a legacy schema_version 1 tiptap doc into v2 blocks. */
export function tiptapDocToV2(doc: JSONContent): NoteBlocksV2 {
  const blocks = (doc.content ?? []).flatMap((node) => nodeToBlocks(node));
  return {
    schema_version: 2,
    editor: "blocknote",
    blocks: blocks.length ? blocks : createEmptyV2().blocks,
  };
}

/** Normalize any stored NoteBlocks (v1 or v2) to v2 for editing. */
export function toV2(blocks: NoteBlocks | NoteBlocksV2): NoteBlocksV2 {
  if (isV2(blocks)) {
    const adapted = blocks.blocks.map(adaptLegacyTable);
    return adapted.some((block, index) => block !== blocks.blocks[index])
      ? { ...blocks, blocks: adapted }
      : blocks;
  }
  return tiptapDocToV2((blocks as { doc: JSONContent }).doc);
}

function adaptLegacyTable(block: OrbisBlock): OrbisBlock {
  const storedChildren = block.children ?? [];
  const children = storedChildren.map(adaptLegacyTable);
  const changedChildren = block.children === undefined || children.some((child, index) => child !== storedChildren[index]);
  const storedContent = block.content ?? [];
  const content = block.type === "table" ? editableTableContent(storedContent) : storedContent;
  const props = block.props ?? {};
  if (content === block.content && props === block.props && !changedChildren) return block;
  return {
    ...block,
    props,
    children: changedChildren ? children : block.children,
    content,
  };
}

/** Keep stored empty tables valid for BlockNote's nonempty table/row schema. */
function editableTableContent(content: OrbisBlock["content"] | LegacyTableContent): OrbisTableContent {
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

function inlineText(inline: OrbisInline): string {
  if (inline.type === "text") return inline.text;
  return typeof inline.content === "string" ? inline.content : inline.content.map(inlineText).join("");
}

function blockContentText(block: OrbisBlock): string {
  if (block.content == null) return "";
  if (typeof block.content === "string") return block.content;
  if (block.type === "table" && isLegacyTableContent(block.content)) {
    return block.content.map((row) => row.map((cell) => tableCellValue(cell, inlineText)).join("\t")).join("\n");
  }
  if (Array.isArray(block.content)) return block.content.map(inlineText).join("");
  return block.content.rows.map((row) => row.cells.map((cell) => tableCellValue(cell, inlineText)).join("\t")).join("\n");
}

function tableCellValue(cell: OrbisTableCell, render: (inline: OrbisInline) => string): string {
  const content = typeof cell === "object" && !Array.isArray(cell) ? cell.content ?? [] : cell;
  return typeof content === "string" ? content : content.map(render).join("");
}

/** Plain text for search / knowledge snapshots, from v2 blocks. */
export function extractPlainTextV2(blocks: OrbisBlock[]): string {
  const lines: string[] = [];
  const visit = (block: OrbisBlock) => {
    const title = documentBlockTitle(block).trim();
    if (title) lines.push(title);
    const text = blockContentText(block).trim();
    if (text) lines.push(text);
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return lines.join("\n");
}

function renderInline(inline: OrbisInline): string {
  if (inline.type === "link") {
    const text = typeof inline.content === "string" ? inline.content : inline.content.map(renderInline).join("");
    return `[${text}](${inline.href})`;
  }
  let value = inline.text;
  const styles = inline.styles ?? {};
  if (styles.code) value = `\`${value}\``;
  if (styles.bold) value = `**${value}**`;
  if (styles.italic) value = `*${value}*`;
  if (styles.strike) value = `~~${value}~~`;
  return value;
}

function renderBlockContent(block: OrbisBlock): string {
  if (block.content == null) return "";
  if (typeof block.content === "string") return block.content;
  if (block.type === "table" && isLegacyTableContent(block.content)) return blockContentText(block);
  if (Array.isArray(block.content)) return block.content.map(renderInline).join("");
  return blockContentText(block);
}

function renderTable(content: OrbisTableContent): string {
  const rows = content.rows.map((row) => row.cells.map((cell) =>
    tableCellValue(cell, renderInline).replaceAll("|", "\\|").replace(/\r\n?|\n/g, "<br>"),
  ));
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width) return "";
  const rendered = rows.map((row) => `| ${[...row, ...Array<string>(width - row.length).fill("")].join(" | ")} |`);
  rendered.splice(1, 0, `| ${Array<string>(width).fill("---").join(" | ")} |`);
  return rendered.join("\n");
}

/** Frontend v2 → Markdown (used for the conflict "copy local" affordance). */
export function v2ToMarkdown(blocks: OrbisBlock[]): string {
  return renderMarkdownBlocks(blocks, 0);
}

function renderMarkdownBlocks(blocks: OrbisBlock[], depth: number): string {
  const out: string[] = [];
  const indent = "  ".repeat(depth);
  let nextNumber = 1;
  let previousNumbered = false;
  let delimiter = ".";
  for (const block of blocks) {
    const text = renderBlockContent(block);
    const component = documentBlockMarkdown(block, text, (children) => renderMarkdownBlocks(children, 0));
    if (component !== null) {
      out.push(component);
      nextNumber = 1; previousNumbered = false; delimiter = ".";
      continue;
    }
    let marker: string | undefined;
    if (block.type === "numberedListItem") {
      const start = Number.isInteger(block.props?.start) ? Number(block.props.start) : undefined;
      // A delimiter change starts a new CommonMark list; a new numeric marker
      // alone would be ignored by Markdown readers during an explicit restart.
      if (previousNumbered && start !== undefined && start !== nextNumber) delimiter = delimiter === "." ? ")" : ".";
      nextNumber = start ?? nextNumber;
      marker = `${nextNumber++}${delimiter} `;
      previousNumbered = true;
    } else {
      nextNumber = 1;
      previousNumbered = false;
      delimiter = ".";
    }
    switch (block.type) {
      case "heading":
        out.push(`${"#".repeat(Number(block.props.level ?? 1))} ${text}`);
        break;
      case "bulletListItem":
        marker = "- ";
        out.push(`${indent}${marker}${text}`);
        break;
      case "numberedListItem":
        out.push(`${indent}${marker}${text}`);
        break;
      case "checkListItem":
        marker = "- ";
        out.push(`${indent}- [${block.props.checked ? "x" : " "}] ${text}`);
        break;
      case "quote": {
        const body = [text, renderMarkdownBlocks(block.children, 0)].filter(Boolean).join("\n\n");
        out.push(body.split("\n").map((line) => `> ${line}`).join("\n"));
        break;
      }
      case "codeBlock":
        out.push(`\`\`\`${(block.props.language as string) ?? ""}\n${blockContentText(block)}\n\`\`\``);
        break;
      case "divider":
        out.push("---");
        break;
      case "table": {
        const content = block.content;
        if (isLegacyTableContent(content)) {
          out.push(renderTable({ type: "tableContent", rows: content.map((cells) => ({ cells })) }));
        } else if (typeof content === "object" && !Array.isArray(content) && content !== null) {
          out.push(renderTable(content));
        } else {
          out.push(`${indent}${text}`);
        }
        break;
      }
      default:
        out.push(`${indent}${text}`);
    }
    if (block.children.length && block.type !== "quote") {
      if (marker) {
        const childIndent = indent + " ".repeat(marker.length);
        out.push(renderMarkdownBlocks(block.children, 0).split("\n").map((line) => line ? `${childIndent}${line}` : "").join("\n"));
      } else {
        out.push(renderMarkdownBlocks(block.children, depth + 1));
      }
    }
  }
  return out.filter(Boolean).join("\n\n");
}
