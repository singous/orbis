import type { JSONContent } from "@tiptap/react";
import { Lexer } from "marked";

import type { TiptapDocument } from "./note-contract";

type MarkdownToken = {
  type: string;
  text?: string;
  raw?: string;
  tokens?: MarkdownToken[];
  depth?: number;
  ordered?: boolean;
  items?: MarkdownToken[];
  task?: boolean;
  checked?: boolean;
  lang?: string;
  href?: string;
  title?: string | null;
  header?: TableCellToken[];
  rows?: TableCellToken[][];
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
  return tokens.flatMap((token) => {
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

    if (token.type === "link") {
      return withMark(inlineTokensToContent(token.tokens), {
        type: "link",
        attrs: { href: token.href ?? "", title: token.title ?? null },
      });
    }

    if (token.type === "image") {
      return textNode(token.text ? `![${token.text}](${token.href ?? ""})` : token.href ?? "");
    }

    return token.tokens?.length ? inlineTokensToContent(token.tokens) : textNode(token.text ?? "");
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
      content: [paragraphFromInline(listItemTextToken(item))],
    })),
  };
}

function listNode(token: MarkdownToken): JSONContent {
  return {
    type: token.ordered ? "orderedList" : "bulletList",
    content: token.items?.map((item) => ({
      type: "listItem",
      content: [paragraphFromInline(listItemTextToken(item))],
    })),
  };
}

function tableCellNode(cell: TableCellToken, type: "tableHeader" | "tableCell"): JSONContent {
  return {
    type,
    content: [paragraphFromInline(cell.tokens, cell.text)],
  };
}

function tableNode(token: MarkdownToken): JSONContent {
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: token.header?.map((cell) => tableCellNode(cell, "tableHeader")),
      },
      ...(token.rows?.map((row) => ({
        type: "tableRow",
        content: row.map((cell) => tableCellNode(cell, "tableCell")),
      })) ?? []),
    ],
  };
}

function blockTokenToNode(token: MarkdownToken): JSONContent | null {
  if (token.type === "space") {
    return null;
  }

  if (token.type === "heading") {
    return {
      type: "heading",
      attrs: { level: Math.min(Math.max(token.depth ?? 1, 1), 3) },
      content: inlineTokensToContent(token.tokens),
    };
  }

  if (token.type === "paragraph") {
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

  return token.text ? paragraphFromInline([], token.text) : null;
}

function tokensToNodes(tokens: MarkdownToken[] = []): JSONContent[] {
  return tokens.map(blockTokenToNode).filter((node): node is JSONContent => Boolean(node));
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
  return /(^|\n)(#{1,6}\s|[-*+]\s+\[[ xX]\]\s|[-*+]\s+|\d+\.\s+|>\s+|```|---\s*$|\|.*\|)/.test(text);
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function renderInline(nodes: JSONContent[] = []): string {
  return nodes
    .map((node) => {
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
          return `[${value}](${String(mark.attrs?.href ?? "")})`;
        }
        return value;
      }, escapeMarkdownText(node.text ?? ""));
    })
    .join("");
}

function renderListItem(node: JSONContent): string {
  return renderInline(node.content?.flatMap((child) => child.content ?? []) ?? []);
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

function renderBlock(node: JSONContent): string {
  if (node.type === "paragraph") {
    return renderInline(node.content);
  }

  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
    return `${"#".repeat(level)} ${renderInline(node.content)}`;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    return (
      node.content
        ?.map((item, index) => `${node.type === "orderedList" ? `${index + 1}.` : "-"} ${renderListItem(item)}`)
        .join("\n") ?? ""
    );
  }

  if (node.type === "taskList") {
    return node.content?.map((item) => `- [${item.attrs?.checked ? "x" : " "}] ${renderListItem(item)}`).join("\n") ?? "";
  }

  if (node.type === "blockquote") {
    return renderBlocks(node.content).split("\n").map((line) => `> ${line}`).join("\n");
  }

  if (node.type === "codeBlock") {
    return `\`\`\`${node.attrs?.language ?? ""}\n${renderInline(node.content)}\n\`\`\``;
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
  return nodes.map(renderBlock).filter(Boolean).join("\n\n");
}

export function tiptapDocToMarkdown(doc: TiptapDocument | JSONContent): string {
  return renderBlocks(doc.content).trim();
}
