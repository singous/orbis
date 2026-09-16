import contract from "./document-blocks.json";
import type { OrbisBlock } from "../notes/block-model";
import { markdownDestination } from "./markdown-urls";

export type DocumentBlockKind = keyof typeof contract.blocks;
export type DocumentPropRule = { default: string | number; values?: Array<string | number>; maxLength?: number };
export type DocumentBlockDefinition = {
  label: string; content: "inline" | "none"; children: "any" | string[];
  props: Record<string, DocumentPropRule>;
};
export const DOCUMENT_BLOCKS = contract.blocks as Record<DocumentBlockKind, DocumentBlockDefinition>;

export function documentBlockDefinition(type: string): DocumentBlockDefinition | undefined {
  return Object.hasOwn(DOCUMENT_BLOCKS, type) ? DOCUMENT_BLOCKS[type as DocumentBlockKind] : undefined;
}

export function documentBlockTitle(block: { type: string; props?: Record<string, unknown> }): string {
  const rule = documentBlockDefinition(block.type)?.props.title;
  return rule ? String(block.props?.title ?? rule.default) : "";
}

function markdownTitle(value: string): string {
  return value.replace(/([\\*_[\]])/g, "\\$1").replaceAll("\n", " ");
}

/** Deliberate Markdown fallback preserves every pane while dropping presentation. */
export function documentBlockMarkdown(block: OrbisBlock, inline: string, render: (blocks: OrbisBlock[]) => string): string | null {
  if (!documentBlockDefinition(block.type)) return null;
  const children = block.children ?? [];
  const title = markdownTitle(documentBlockTitle(block));
  if (block.type === "callout") {
    return [title ? "**" + title + "**" : "", inline, render(children)].filter(Boolean).join("\n\n")
      .split("\n").map((line) => line ? "> " + line : ">").join("\n");
  }
  if (["card", "step", "tab"].includes(block.type)) {
    const href = block.type === "card" ? block.props.href : null;
    const heading = href ? "### [" + title + "](" + markdownDestination(String(href)) + ")" : "### " + title;
    return [heading, inline, render(children)].filter(Boolean).join("\n\n");
  }
  if (block.type === "steps") {
    return children.map((child, index) => {
      const marker = String(index + 1) + ". ";
      const heading = marker + "**" + markdownTitle(documentBlockTitle(child)) + "**";
      const body = render(child.children ?? []);
      return heading + (body ? "\n\n" + body.split("\n").map((line) => line ? " ".repeat(marker.length) + line : "").join("\n") : "");
    }).join("\n\n");
  }
  return render(children);
}
