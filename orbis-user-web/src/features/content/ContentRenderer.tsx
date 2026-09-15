import { Fragment, createElement, type ReactNode } from "react";

type ContentNode = Record<string, unknown>;
export type ContentOutlineItem = { id: string; text: string; level: number };

function node(value: unknown): ContentNode {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ContentNode : {};
}

function nodes(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(text).join("");
  const item = node(value);
  if (typeof item.text === "string") return item.text;
  return text(item.content);
}

/** Public content may link to HTTPS resources, email, or an anchor on this page. */
export function safeContentUrl(value: unknown, media = false): string | null {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  if (!media && value.startsWith("#")) return value;
  try {
    const parsed = new URL(value);
    const protocols = media ? ["https:", "http:"] : ["https:", "http:", "mailto:"];
    return protocols.includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

function roots(blocks: unknown): { items: unknown[]; legacy: boolean } {
  const document = node(blocks);
  const legacy = document.schema_version !== 2;
  return { items: nodes(legacy ? node(document.doc).content : document.blocks), legacy };
}

function headingLevel(value: unknown): number {
  return Math.max(1, Math.min(6, Number(value) || 2));
}

export function contentOutline(blocks: unknown, pageTitle?: string): ContentOutlineItem[] {
  const { items, legacy } = roots(blocks);
  const result: ContentOutlineItem[] = [];
  const walk = (values: unknown[], prefix: number[]) => values.forEach((value, index) => {
    const item = node(value);
    const path = [...prefix, index];
    const duplicateTitle = path.length === 1 && index === 0 && text(item.content).trim() === pageTitle?.trim();
    if (item.type === "heading" && !duplicateTitle) result.push({
      id: `heading-${path.join("-")}`,
      text: text(item.content),
      level: headingLevel(node(legacy ? item.attrs : item.props).level),
    });
    walk(nodes(legacy ? item.content : item.children), path);
  });
  walk(items, []);
  return result;
}

function inline(value: unknown): ReactNode {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) return value.map((part, index) => <Fragment key={index}>{inline(part)}</Fragment>);
  const item = node(value);
  if (item.type === "link") {
    const href = safeContentUrl(item.href);
    const children = inline(item.content);
    return href ? <a href={href} rel="noopener noreferrer">{children}</a> : children;
  }
  let result: ReactNode = typeof item.text === "string" ? item.text : inline(item.content);
  const styles = { ...node(item.styles) };
  for (const value of nodes(item.marks)) {
    const mark = node(value);
    if (mark.type === "link") {
      const href = safeContentUrl(node(mark.attrs).href);
      if (href) result = <a href={href} rel="noopener noreferrer">{result}</a>;
    } else if (typeof mark.type === "string") styles[mark.type] = true;
  }
  if (styles.code) result = <code>{result}</code>;
  if (styles.bold) result = <strong>{result}</strong>;
  if (styles.italic) result = <em>{result}</em>;
  if (styles.underline) result = <u>{result}</u>;
  if (styles.strike) result = <s>{result}</s>;
  return result;
}

function nativeTable(content: ContentNode): ReactNode {
  const headerRows = Number(content.headerRows) || 0;
  const rows = nodes(content.rows).map((row, rowIndex) => (
    <tr key={rowIndex}>{nodes(node(row).cells).map((cell, cellIndex) => {
      const cellNode = node(cell);
      const value = cellNode.type === "tableCell" ? cellNode.content : cell;
      const Tag = rowIndex < headerRows || cellIndex < Number(content.headerCols || 0) ? "th" : "td";
      const props = node(cellNode.props);
      return <Tag key={cellIndex} scope={Tag === "th" ? rowIndex < headerRows ? "col" : "row" : undefined} colSpan={Number(props.colspan) || undefined} rowSpan={Number(props.rowspan) || undefined}>{inline(value)}</Tag>;
    })}</tr>
  ));
  return <div className="content-table-scroll"><table><tbody>{rows}</tbody></table></div>;
}

function renderBlock(value: unknown, path: number[], legacy: boolean, pageTitle?: string): ReactNode {
  const item = node(value);
  const props = node(legacy ? item.attrs : item.props);
  const content = inline(item.content);
  const children = renderNodes(nodes(legacy ? item.content : item.children), path, legacy);
  switch (item.type) {
    case "text": return inline(item);
    case "heading": {
      const duplicateTitle = path.length === 1 && path[0] === 0 && text(item.content).trim() === pageTitle?.trim();
      return <>{duplicateTitle ? null : createElement(`h${headingLevel(props.level)}`, { id: `heading-${path.join("-")}` }, content)}{legacy ? null : children}</>;
    }
    case "paragraph": return <><p>{content || <br />}</p>{legacy ? null : children}</>;
    case "codeBlock": return <><div className="content-code"><div className="content-code-language">{String(props.language || "text")}</div><pre><code>{text(item.content)}</code></pre></div>{legacy ? null : children}</>;
    case "blockquote": return <blockquote>{children}</blockquote>;
    case "quote": return <blockquote>{content}{children}</blockquote>;
    case "bulletList": return <ul>{children}</ul>;
    case "orderedList": return <ol start={Number(props.start) || 1}>{children}</ol>;
    case "taskList": return <ul className="content-task-list">{children}</ul>;
    case "listItem": return <li>{children}</li>;
    case "taskItem": return <li className="content-task"><input type="checkbox" checked={Boolean(props.checked)} disabled aria-label="待办事项" /><div>{children}</div></li>;
    case "bulletListItem":
    case "numberedListItem": return <li>{content}{children}</li>;
    case "checkListItem": return <li className="content-task"><input type="checkbox" checked={Boolean(props.checked)} disabled aria-label="待办事项" /><div>{content}{children}</div></li>;
    case "horizontalRule":
    case "divider": return <><hr />{legacy ? null : children}</>;
    case "table": {
      if (legacy) return <div className="content-table-scroll"><table><tbody>{children}</tbody></table></div>;
      const table = node(item.content).type === "tableContent" ? node(item.content)
        : Array.isArray(item.content) && item.content.some(Array.isArray) ? { rows: item.content.map((cells) => ({ cells })) } : null;
      return <>{table ? nativeTable(table) : <p>{content}</p>}{children}</>;
    }
    case "tableRow": return <tr>{children}</tr>;
    case "tableHeader": return <th scope="col" colSpan={Number(props.colspan) || undefined} rowSpan={Number(props.rowspan) || undefined}>{children}</th>;
    case "tableCell": return <td colSpan={Number(props.colspan) || undefined} rowSpan={Number(props.rowspan) || undefined}>{children}</td>;
    case "toggleListItem": return <details><summary>{content}</summary>{children}</details>;
    case "image":
    case "video":
    case "audio":
    case "file": {
      const url = safeContentUrl(props.url, true);
      const caption = String(props.caption || props.name || "附件");
      if (!url) return <><p className="content-unavailable">{caption}（资源不可用）</p>{children}</>;
      return <><figure>{item.type === "image" ? <img src={url} alt={caption} loading="lazy" />
        : item.type === "video" ? <video src={url} controls preload="metadata" aria-label={caption} />
        : item.type === "audio" ? <audio src={url} controls preload="metadata" aria-label={caption} />
        : <a href={url} rel="noopener noreferrer">{caption}</a>}
        {props.caption ? <figcaption>{String(props.caption)}</figcaption> : null}</figure>{children}</>;
    }
    default: return <>{content}{children}</>;
  }
}

function renderNodes(items: unknown[], prefix: number[], legacy: boolean, pageTitle?: string): ReactNode[] {
  const result: ReactNode[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const type = node(items[index]).type;
    const key = [...prefix, index].join("-");
    if (!legacy && ["bulletListItem", "numberedListItem", "checkListItem"].includes(String(type))) {
      const grouped: ReactNode[] = [];
      do {
        grouped.push(<Fragment key={index}>{renderBlock(items[index], [...prefix, index], legacy)}</Fragment>);
        index += 1;
      } while (index < items.length && node(items[index]).type === type);
      index -= 1;
      result.push(type === "numberedListItem" ? <ol key={key}>{grouped}</ol> : <ul key={key} className={type === "checkListItem" ? "content-task-list" : undefined}>{grouped}</ul>);
    } else result.push(<Fragment key={key}>{renderBlock(items[index], [...prefix, index], legacy, pageTitle)}</Fragment>);
  }
  return result;
}

/** Render persisted content without loading the editor or executing embedded HTML. */
export function ContentRenderer({ blocks, pageTitle }: { blocks: unknown; pageTitle?: string }) {
  const { items, legacy } = roots(blocks);
  return <div className="document-prose">{renderNodes(items, [], legacy, pageTitle)}</div>;
}
