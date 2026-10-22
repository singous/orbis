import { Fragment, createElement, lazy, Suspense, type ReactNode } from "react";
import type { TableSnapshot } from "../data-tables/model";
import { DrawingPreview } from "../drawing/DrawingPreview";
import { CodeBlock } from "./CodeBlock";
import { DocumentBlock } from "./DocumentBlock";
import { ContentMedia, ManagedContentLink } from "./ContentMedia";
import { contentCellStyle, contentInlineStyle, contentTextAlignment } from "./content-format";
import { documentBlockDefinition } from "./model/document-components";
import "../../styles/document-components.css";

type ContentNode = Record<string, unknown>;
export type ContentOutlineItem = { id: string; text: string; level: number };
const PUBLIC_ASSET_PATH = /^\/public\/sites\/[a-z0-9]+(?:-[a-z0-9]+)*\/assets\/[0-9a-f]{64}$/;
const ReadSheetEmbed=lazy(()=>import("../sheets/SheetEmbed").then(m=>({default:m.SheetEmbed})));
const ReadDataTable = lazy(() => import("../data-tables/DataTable").then(module => ({ default: module.DataTableBlock })));
const ReadDataTableSnapshot = lazy(() => import("../data-tables/DataTableSnapshot").then(module => ({ default: module.DataTableSnapshot })));
const PUBLIC_PAGE_PATH = /^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*(?:#[a-zA-Z0-9_-]+)?$/;

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
  if (PUBLIC_ASSET_PATH.test(value) || !media && PUBLIC_PAGE_PATH.test(value)) return value;
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

function headingPath(item: ContentNode, path: number[], legacy: boolean): string {
  const id = item.id;
  return !legacy && typeof id === "string" && /^public-(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*))*$/.test(id)
    ? id.slice("public-".length) : path.join("-");
}

export function contentOutline(blocks: unknown, pageTitle?: string): ContentOutlineItem[] {
  const { items, legacy } = roots(blocks);
  const result: ContentOutlineItem[] = [];
  const walk = (values: unknown[], prefix: number[]) => values.forEach((value, index) => {
    const item = node(value);
    const path = [...prefix, index];
    const anchor = headingPath(item, path, legacy);
    const duplicateTitle = anchor === "0" && text(item.content).trim() === pageTitle?.trim();
    if (item.type === "heading" && !duplicateTitle) result.push({
      id: `heading-${anchor}`,
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
    return <ManagedContentLink reference={typeof item.href === "string" ? item.href : undefined} fallback={href}>{children}</ManagedContentLink>;
  }
  let result: ReactNode = typeof item.text === "string" ? item.text : inline(item.content);
  const styles = { ...node(item.styles) };
  for (const value of nodes(item.marks)) {
    const mark = node(value);
    if (mark.type === "link") {
      const href = safeContentUrl(node(mark.attrs).href);
      const raw = node(mark.attrs).href;
      result = <ManagedContentLink reference={typeof raw === "string" ? raw : undefined} fallback={href}>{result}</ManagedContentLink>;
    } else if (typeof mark.type === "string") styles[mark.type] = true;
  }
  if (styles.code) result = <code>{result}</code>;
  if (styles.bold) result = <strong>{result}</strong>;
  if (styles.italic) result = <em>{result}</em>;
  if (styles.underline) result = <u>{result}</u>;
  if (styles.strike) result = <s>{result}</s>;
  const colorStyle = contentInlineStyle(styles);
  if (colorStyle.color || colorStyle.backgroundColor) result = <span style={colorStyle}>{result}</span>;
  return result;
}

function nativeTable(content: ContentNode): ReactNode {
  const widths = nodes(content.columnWidths).map((value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
  const fixedWidth = widths.length && widths.every((value) => value !== undefined) ? widths.reduce<number>((total, value) => total + (value ?? 0), 0) : undefined;
  const headerRows = Number(content.headerRows) || 0;
  const rows = nodes(content.rows).map((row, rowIndex) => (
    <tr key={rowIndex}>{nodes(node(row).cells).map((cell, cellIndex) => {
      const cellNode = node(cell);
      const value = cellNode.type === "tableCell" ? cellNode.content : cell;
      const Tag = rowIndex < headerRows || cellIndex < Number(content.headerCols || 0) ? "th" : "td";
      const props = node(cellNode.props);
      return <Tag key={cellIndex} scope={Tag === "th" ? rowIndex < headerRows ? "col" : "row" : undefined} colSpan={Number(props.colspan) || undefined} rowSpan={Number(props.rowspan) || undefined} style={contentCellStyle(props)}>{inline(value)}</Tag>;
    })}</tr>
  ));
  return <div className="content-table-scroll"><table style={fixedWidth ? { width: fixedWidth } : undefined}>{widths.length ? <colgroup>{widths.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}</colgroup> : null}<tbody>{rows}</tbody></table></div>;
}

function renderBlock(value: unknown, path: number[], legacy: boolean, pageTitle?: string): ReactNode {
  const item = node(value);
  const props = node(legacy ? item.attrs : item.props);
  const content = inline(item.content);
  if (item.type === "dataTable" && props.sheet_id) return <Suspense fallback={<p>正在读取数据表…</p>}><ReadSheetEmbed id={String(props.sheet_id)} viewId={String(props.sheet_view_id??"")} readOnly /></Suspense>;
  if (item.type === "dataTable") return <Suspense fallback={<p>正在读取数据表…</p>}>{item.table_snapshot ? <ReadDataTableSnapshot data={item.table_snapshot as TableSnapshot} /> : <ReadDataTable blockId={String(item.id)} props={props} readOnly />}</Suspense>;
  if (!legacy && documentBlockDefinition(String(item.type))) {
    const children = ["steps", "tabs", "codeGroup"].includes(String(item.type)) ? null : renderNodes(nodes(item.children), path, false);
    return <DocumentBlock kind={String(item.type)} props={props} inline={content} children={children}
      childBlocks={nodes(item.children)} path={path} safeUrl={safeContentUrl}
      renderChild={(child, childPath) => renderBlock(child, childPath, false)}
      renderChildren={(values, prefix) => renderNodes(values, prefix, false)} />;
  }
  const children = renderNodes(nodes(legacy ? item.content : item.children), path, legacy);
  switch (item.type) {
    case "text": return inline(item);
    case "heading": {
      const anchor = headingPath(item, path, legacy);
      const duplicateTitle = anchor === "0" && text(item.content).trim() === pageTitle?.trim();
      return <>{duplicateTitle ? null : createElement(`h${headingLevel(props.level)}`, { id: `heading-${anchor}`, style: { textAlign: contentTextAlignment(props.textAlignment) } }, content)}{legacy ? null : children}</>;
    }
    case "paragraph": return <><p style={{ textAlign: contentTextAlignment(props.textAlignment) }}>{content || <br />}</p>{legacy ? null : children}</>;
    case "codeBlock": return <><CodeBlock source={text(item.content)} language={String(props.language || "text")} />{legacy ? null : children}</>;
    case "blockquote": return <blockquote>{children}</blockquote>;
    case "quote": return <blockquote>{content}{children}</blockquote>;
    case "bulletList": return <ul>{children}</ul>;
    case "orderedList": return <ol start={Number(props.start) || 1}>{children}</ol>;
    case "taskList": return <ul className="content-task-list">{children}</ul>;
    case "listItem": return <li>{children}</li>;
    case "taskItem": return <li className="content-task"><input type="checkbox" checked={Boolean(props.checked)} disabled aria-label="待办事项" /><div>{children}</div></li>;
    case "bulletListItem": return <li>{content}{children}</li>;
    case "numberedListItem": return <li value={typeof props.start === "number" && Number.isInteger(props.start) ? props.start : undefined}>{content}{children}</li>;
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
    case "drawing": return <DrawingPreview props={props} />;
    case "image":
    case "video":
    case "audio":
    case "file": {
      return <><ContentMedia kind={item.type} reference={typeof props.url === "string" ? props.url : undefined}
        fallback={safeContentUrl(props.url, true)} name={String(props.name || props.caption || "附件")}
        caption={props.caption ? String(props.caption) : undefined} previewWidth={props.previewWidth} />{children}</>;
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
      const start = node(node(items[index]).props).start;
      do {
        grouped.push(<Fragment key={index}>{renderBlock(items[index], [...prefix, index], legacy)}</Fragment>);
        index += 1;
      } while (index < items.length && node(items[index]).type === type);
      index -= 1;
      result.push(type === "numberedListItem" ? <ol key={key} start={typeof start === "number" && Number.isInteger(start) ? start : undefined}>{grouped}</ol> : <ul key={key} className={type === "checkListItem" ? "content-task-list" : undefined}>{grouped}</ul>);
    } else result.push(<Fragment key={key}>{renderBlock(items[index], [...prefix, index], legacy, pageTitle)}</Fragment>);
  }
  return result;
}

/** Render persisted content without loading the editor or executing embedded HTML. */
export function ContentRenderer({ blocks, pageTitle }: { blocks: unknown; pageTitle?: string }) {
  const { items, legacy } = roots(blocks);
  return <div className="document-prose">{renderNodes(items, [], legacy, pageTitle)}</div>;
}
