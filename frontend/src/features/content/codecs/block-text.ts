import type { OrbisBlock, OrbisInline, OrbisTableCell, OrbisTableContent } from "../model/block-model";
import { isLegacyTableContent } from "../model/table-content";
import { documentBlockMarkdown, documentBlockTitle } from "../model/document-components";
import { markdownCodeFence, markdownDestination } from "../model/markdown-urls";

function inlineText(inline: OrbisInline): string {
  if (inline.type === "text") return inline.text;
  return typeof inline.content === "string" ? inline.content : inline.content.map(inlineText).join("");
}

function blockContentText(block: OrbisBlock): string {
  if (block.type === "drawing") return "";
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
    return `[${text}](${markdownDestination(inline.href)})`;
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
        out.push(markdownCodeFence(blockContentText(block), String(block.props.language || "")));
        break;
      case "divider":
        out.push("---");
        break;
      case "image":
      case "video":
      case "audio":
      case "file": {
        const label = String(block.props.caption || block.props.name || text || block.type).replace(/([\\[\]])/g, "\\$1");
        const url = String(block.props.url || "");
        out.push(url ? `${block.type === "image" ? "!" : ""}[${label}](${markdownDestination(url)})` : label);
        break;
      }
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
