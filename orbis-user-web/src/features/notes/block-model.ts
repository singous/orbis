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

export type OrbisInlineStyle = Partial<
  Record<"bold" | "italic" | "underline" | "strike" | "code", true>
>;

export type OrbisInline =
  | { type: "text"; text: string; styles?: OrbisInlineStyle }
  | { type: "link"; href: string; content: OrbisInline[] };

export type OrbisBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: OrbisInline[] | string;
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
    case "table": {
      // Lossy migration: render rows as paragraphs separated by " | ".
      const rows: string[] = [];
      for (const row of node.content ?? []) {
        const cells = (row.content ?? []).map((cell) => cellText(cell)).join(" | ");
        rows.push(cells);
      }
      return rows.map((line) => ({ ...blockBase("paragraph"), content: [{ type: "text", text: line }] }));
    }
    default:
      // Unknown node: flatten any text content into a paragraph.
      return [{ ...blockBase("paragraph"), content: inlineFromTiptap(node.content) }];
  }
}

function cellText(node: JSONContent): string {
  return (node.content ?? [])
    .map((child) => (child.content ?? []).map((t) => t.text ?? "").join(""))
    .join(" ");
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
  if (isV2(blocks)) return blocks;
  return tiptapDocToV2((blocks as { doc: JSONContent }).doc);
}

function inlineText(inline: OrbisInline): string {
  return inline.type === "text" ? inline.text : inline.content.map(inlineText).join("");
}

function blockContentText(block: OrbisBlock): string {
  if (block.content == null) return "";
  return typeof block.content === "string" ? block.content : block.content.map(inlineText).join("");
}

/** Plain text for search / knowledge snapshots, from v2 blocks. */
export function extractPlainTextV2(blocks: OrbisBlock[]): string {
  const lines: string[] = [];
  const visit = (block: OrbisBlock) => {
    const text = blockContentText(block).trim();
    if (text) lines.push(text);
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return lines.join("\n");
}

function renderInline(inline: OrbisInline): string {
  if (inline.type === "link") {
    return `[${inline.content.map(renderInline).join("")}](${inline.href})`;
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
  return typeof block.content === "string" ? block.content : block.content.map(renderInline).join("");
}

/** Frontend v2 → Markdown (used for the conflict "copy local" affordance). */
export function v2ToMarkdown(blocks: OrbisBlock[]): string {
  const out: string[] = [];
  const walk = (block: OrbisBlock, depth: number) => {
    const indent = "  ".repeat(depth);
    const text = renderBlockContent(block);
    switch (block.type) {
      case "heading":
        out.push(`${"#".repeat(Number(block.props.level ?? 1))} ${text}`);
        break;
      case "bulletListItem":
        out.push(`${indent}- ${text}`);
        break;
      case "numberedListItem":
        out.push(`${indent}1. ${text}`);
        break;
      case "checkListItem":
        out.push(`${indent}- [${block.props.checked ? "x" : " "}] ${text}`);
        break;
      case "quote":
        out.push((text || block.children.map((c) => renderBlockContent(c)).join(" "))
          .split("\n").map((l) => `> ${l}`).join("\n"));
        break;
      case "codeBlock":
        out.push(`\`\`\`${(block.props.language as string) ?? ""}\n${block.content}\n\`\`\``);
        break;
      case "divider":
        out.push("---");
        break;
      default:
        out.push(`${indent}${text}`);
    }
    block.children.forEach((child) => walk(child, depth + 1));
  };
  blocks.forEach((block) => walk(block, 0));
  return out.filter(Boolean).join("\n\n");
}
