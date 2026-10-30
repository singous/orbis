import type { JSONContent } from "@tiptap/react";
import type { NoteBlocks } from "../../../shared/api/schemas";
import { createEmptyV2, isV2, newBlockId, type NoteBlocksV2, type OrbisBlock, type OrbisInline, type OrbisInlineStyle, type OrbisTableContent } from "../model/block-model";
import { editableTableContent } from "../model/table-content";

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
