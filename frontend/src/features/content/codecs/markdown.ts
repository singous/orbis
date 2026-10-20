import type { JSONContent } from "@tiptap/react";
import { Lexer } from "marked";
import { markdownCodeFence, markdownDestination, supportedMarkdownHref } from "../model/markdown-urls";

import type { TiptapDocument } from "./tiptap-document";

type MarkdownToken = {
  type: string;
  text?: string;
  raw?: string;
  tokens?: MarkdownToken[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  items?: MarkdownToken[];
  task?: boolean;
  checked?: boolean;
  lang?: string;
  href?: string;
  title?: string | null;
  header?: TableCellToken[];
  rows?: TableCellToken[][];
  align?: Array<"left" | "center" | "right" | null>;
};

type TableCellToken = {
  text: string;
  tokens?: MarkdownToken[];
};

type TiptapMark = NonNullable<JSONContent["marks"]>[number];

function textNode(text: string, marks?: TiptapMark[]): JSONContent[] {
  return text ? [{ type: "text", text, ...(marks?.length ? { marks } : {}) }] : [];
}

function withMark(content: JSONContent[], mark: TiptapMark): JSONContent[] {
  return content.map((node) => {
    if (node.type !== "text") {
      return node;
    }
    return {
      ...node,
      marks: [...(node.marks ?? []), mark],
    };
  });
}

function inlineTokensToContent(tokens: MarkdownToken[] = []): JSONContent[] {
  // Inline HTML has no native representation. Preserve its complete authored
  // inline context rather than interpreting Markdown inside a literal tag pair.
  if (tokens.some(token => token.type === "html")) return textNode(tokens.map(token => token.raw ?? token.text ?? "").join(""));
  return tokens.flatMap((token) => {
    if (token.type === "checkbox") return [];
    if (token.type === "escape") return textNode(token.text ?? token.raw ?? "");
    if (token.type === "text") {
      return token.tokens?.length ? inlineTokensToContent(token.tokens) : textNode(token.text ?? "");
    }

    if (token.type === "strong") {
      return withMark(inlineTokensToContent(token.tokens), { type: "bold" });
    }

    if (token.type === "em") {
      return withMark(inlineTokensToContent(token.tokens), { type: "italic" });
    }

    if (token.type === "del") {
      return withMark(inlineTokensToContent(token.tokens), { type: "strike" });
    }

    if (token.type === "codespan") {
      return textNode(token.text ?? "", [{ type: "code" }]);
    }

    if (token.type === "br") {
      return [{ type: "hardBreak" }];
    }

    if (token.type === "link") {
      // The native inline contract stores href and label but has no link title.
      // Keep that unsupported author metadata in the visible source instead.
      if (token.title || !supportedMarkdownHref(token.href ?? "")) return textNode(token.raw ?? `[${token.text ?? ""}](${token.href ?? ""}${token.title ? ` "${token.title}"` : ""})`);
      return withMark(inlineTokensToContent(token.tokens), {
        type: "link",
        attrs: { href: token.href ?? "", title: token.title ?? null },
      });
    }

    if (token.type === "image") {
      return textNode(token.raw ?? `![${token.text ?? ""}](${token.href ?? ""})`);
    }

    // Unsupported inline syntax (including raw HTML) stays visible verbatim.
    return textNode(token.raw ?? token.text ?? "");
  });
}

function paragraphFromInline(tokens: MarkdownToken[] = [], fallback = ""): JSONContent {
  const content = inlineTokensToContent(tokens);
  return {
    type: "paragraph",
    ...(content.length ? { content } : fallback ? { content: textNode(fallback) } : {}),
  };
}

function listItemTextToken(item: MarkdownToken): MarkdownToken[] {
  const textToken = item.tokens?.find((token) => token.type === "text");
  return textToken?.tokens?.length ? textToken.tokens : textToken ? [textToken] : textNodeToken(item.text ?? "");
}

function textNodeToken(text: string): MarkdownToken[] {
  return text ? [{ type: "text", text }] : [];
}

function taskListNode(token: MarkdownToken): JSONContent {
  return {
    type: "taskList",
    content: token.items?.map((item) => ({
      type: "taskItem",
      attrs: { checked: Boolean(item.checked) },
      content: item.tokens?.length ? tokensToNodes(item.tokens) : [paragraphFromInline(listItemTextToken(item))],
    })),
  };
}

function listNode(token: MarkdownToken): JSONContent {
  return {
    type: token.ordered ? "orderedList" : "bulletList",
    ...(token.ordered ? { attrs: { start: token.start ?? 1 } } : {}),
    content: token.items?.map((item) => ({
      type: "listItem",
      content: item.tokens?.length ? tokensToNodes(item.tokens) : [paragraphFromInline(listItemTextToken(item))],
    })),
  };
}

function tableCellNode(cell: TableCellToken, type: "tableHeader" | "tableCell", alignment?: "left" | "center" | "right" | null): JSONContent {
  return {
    type,
    ...(alignment ? { attrs: { orbisCellProps: { textAlignment: alignment } } } : {}),
    content: [paragraphFromInline(cell.tokens, cell.text)],
  };
}

function tableNode(token: MarkdownToken): JSONContent {
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: token.header?.map((cell, index) => tableCellNode(cell, "tableHeader", token.align?.[index])),
      },
      ...(token.rows?.map((row) => ({
        type: "tableRow",
        content: row.map((cell, index) => tableCellNode(cell, "tableCell", token.align?.[index])),
      })) ?? []),
    ],
  };
}

function blockTokenToNode(token: MarkdownToken): JSONContent | null {
  if (token.type === "space" || token.type === "checkbox") {
    return null;
  }

  if (token.type === "heading") {
    return {
      type: "heading",
      attrs: { level: Math.min(Math.max(token.depth ?? 1, 1), 6) },
      content: inlineTokensToContent(token.tokens),
    };
  }

  if (token.type === "paragraph" || token.type === "text") {
    return paragraphFromInline(token.tokens, token.text);
  }

  if (token.type === "list") {
    return token.items?.every((item) => item.task) ? taskListNode(token) : listNode(token);
  }

  if (token.type === "blockquote") {
    return {
      type: "blockquote",
      content: tokensToNodes(token.tokens),
    };
  }

  if (token.type === "code") {
    return {
      type: "codeBlock",
      attrs: { language: token.lang ?? null },
      content: textNode(token.text ?? ""),
    };
  }

  if (token.type === "hr") {
    return { type: "horizontalRule" };
  }

  if (token.type === "table") {
    return tableNode(token);
  }

  const literal = token.raw ?? token.text;
  return literal ? paragraphFromInline([], literal) : null;
}

function tokensToNodes(tokens: MarkdownToken[] = []): JSONContent[] {
  return tokens.flatMap((token) => {
    if (token.type === "list" && token.items?.some((item) => item.task) && !token.items.every((item) => item.task)) {
      const groups: MarkdownToken[] = [];
      for (const [index, item] of token.items.entries()) {
        let group = groups.at(-1);
        if (!group || Boolean(group.items![0].task) !== Boolean(item.task)) {
          group = { ...token, start: (token.start ?? 1) + index, items: [] };
          groups.push(group);
        }
        group.items!.push(item);
      }
      return groups.map((group) => blockTokenToNode(group)!);
    }
    const node = blockTokenToNode(token);
    return node ? [node] : [];
  });
}

export function markdownToTiptapDoc(markdown: string): TiptapDocument {
  const tokens = new Lexer({ gfm: true }).lex(markdown) as MarkdownToken[];
  const content = tokensToNodes(tokens);
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)( {0,3}(#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>\s*|`{3,}|~{3,}|(?:[-*_]\s*){3,}$|\|.*\|)|(?: {4}|\t)\S)/m.test(text)
    || /\n {0,3}(?:=+|-+)\s*(?:\n|$)/.test(text)
    || /(?:\*\*|__|~~|`)[^\n]+?(?:\*\*|__|~~|`)|(?:^|\W)[*_][^\s*_][^\n]*?[^\s*_][*_](?:\W|$)|!?\[[^\]\n]*\]\([^\n]+\)/.test(text);
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function renderInline(nodes: JSONContent[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      if (node.type !== "text") {
        return renderInline(node.content);
      }

      return (node.marks ?? []).reduce((value, mark) => {
        if (mark.type === "bold") {
          return `**${value}**`;
        }
        if (mark.type === "italic") {
          return `*${value}*`;
        }
        if (mark.type === "strike") {
          return `~~${value}~~`;
        }
        if (mark.type === "code") {
          return `\`${value}\``;
        }
        if (mark.type === "link") {
          return `[${value}](${markdownDestination(String(mark.attrs?.href ?? ""))})`;
        }
        return value;
      }, escapeMarkdownText(node.text ?? ""));
    })
    .join("");
}

function renderTableCell(node: JSONContent): string {
  return renderInline(node.content?.flatMap((child) => child.content ?? []) ?? []);
}

function renderTable(node: JSONContent): string {
  const rows = node.content ?? [];
  if (!rows.length) {
    return "";
  }

  const renderedRows = rows.map((row) => row.content?.map(renderTableCell) ?? []);
  const width = Math.max(...renderedRows.map((row) => row.length));
  const normalizeRow = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? "");
  const header = normalizeRow(renderedRows[0] ?? []);
  const body = renderedRows.slice(1).map(normalizeRow);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderBlock(node: JSONContent, orderedDelimiter = "."): string {
  if (node.type === "paragraph") {
    return renderInline(node.content);
  }

  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
    return `${"#".repeat(level)} ${renderInline(node.content)}`;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const start = Number.isInteger(node.attrs?.start) ? Number(node.attrs!.start) : 1;
    return (
      node.content
        ?.map((item, index) => {
          const marker = node.type === "orderedList" ? `${index + start}${orderedDelimiter} ` : "- ";
          const body = renderBlocks(item.content).split("\n");
          return `${marker}${body.map((line, lineIndex) => lineIndex && line ? " ".repeat(marker.length) + line : line).join("\n")}`;
        })
        .join("\n") ?? ""
    );
  }

  if (node.type === "taskList") {
    return node.content?.map((item) => {
      const body = renderBlocks(item.content).split("\n").map((line, index) => index && line ? `  ${line}` : line).join("\n");
      return `- [${item.attrs?.checked ? "x" : " "}] ${body}`;
    }).join("\n") ?? "";
  }

  if (node.type === "blockquote") {
    return renderBlocks(node.content).split("\n").map((line) => `> ${line}`).join("\n");
  }

  if (node.type === "codeBlock") {
    const literal = (nodes: JSONContent[] = []): string => nodes.map((item) => item.text ?? (item.type === "hardBreak" ? "\n" : literal(item.content))).join("");
    return markdownCodeFence(literal(node.content), String(node.attrs?.language || ""));
  }

  if (node.type === "horizontalRule") {
    return "---";
  }

  if (node.type === "table") {
    return renderTable(node);
  }

  return renderInline(node.content);
}

function renderBlocks(nodes: JSONContent[] = []): string {
  let delimiter = ".";
  return nodes.map((node, index) => {
    delimiter = node.type === "orderedList" && nodes[index - 1]?.type === "orderedList"
      ? delimiter === "." ? ")" : "." : ".";
    return renderBlock(node, delimiter);
  }).filter(Boolean).join("\n\n");
}

export function tiptapDocToMarkdown(doc: TiptapDocument | JSONContent): string {
  return renderBlocks(doc.content).trim();
}
