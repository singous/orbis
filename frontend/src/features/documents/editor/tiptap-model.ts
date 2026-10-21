import type { JSONContent } from "@tiptap/react";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { documentBlockDefinition } from "../../content/model/document-components";
import { fingerprintText } from "../../content/codecs/collaboration-fingerprint";
import { canonicalJSON, newBlockId, type NoteBlocksV2, type OrbisBlock, type OrbisInline, type OrbisTableCell, type OrbisTableContent } from "../../content/model/blocks";

const INLINE_MARKS = ["bold", "italic", "underline", "strike", "code"] as const;
const LIST_TYPES = { bulletListItem: "bulletList", numberedListItem: "orderedList", checkListItem: "taskList" } as const;
type ListBlockType = keyof typeof LIST_TYPES;
type StoredNode = JSONContent & { attrs?: Record<string, unknown> };

function clone<T>(value: T): T { return structuredClone(value); }

/** Only content and meaningful attributes enter the signature. ProseMirror adds
 * schema defaults while loading JSON; they must not turn untouched old blocks
 * into rewritten blocks when another paragraph is edited. */
function signatureValue(node: JSONContent): unknown {
  const attrs = node.attrs ?? {};
  const kept = Object.fromEntries(Object.entries(attrs).filter(([key, value]) =>
    !["orbisOriginal", "orbisSignature", "orbisOwn"].includes(key) && value !== null && value !== undefined &&
    !(key === "colspan" && value === 1) && !(key === "rowspan" && value === 1) &&
    !(key === "start" && value === 1) && !(["checked", "orbisOwn"].includes(key) && value === false),
  ));
  return { type: node.type, text: node.text, marks: node.marks, attrs: kept, content: node.content?.map(signatureValue) };
}

function signature(node: JSONContent): string { return canonicalJSON(signatureValue(node)); }

function own(node: StoredNode, block: OrbisBlock, cacheMetadata = true): StoredNode {
  if (!cacheMetadata) return node;
  node.attrs = { ...node.attrs, orbisOriginal: clone(block) };
  node.attrs.orbisSignature = signature(node);
  return node;
}

function original(node: JSONContent, type?: string): OrbisBlock | null {
  const source = node.attrs?.orbisOriginal as OrbisBlock | undefined;
  if (!source || (type && source.type !== type)) return null;
  return node.attrs?.orbisSignature === signature(node) ? clone(source) : null;
}

function inlineToNodes(value: OrbisBlock["content"] | OrbisTableCell): JSONContent[] {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (!Array.isArray(value)) {
    if ("type" in value && value.type === "tableCell") return inlineToNodes(value.content ?? []);
    return [];
  }
  const nodes: JSONContent[] = [];
  const append = (inline: OrbisInline, href?: string) => {
    if (inline.type === "link") {
      const parts = typeof inline.content === "string" ? [{ type: "text" as const, text: inline.content }] : inline.content;
      parts.forEach((part) => append(part, inline.href));
      return;
    }
    const styles = inline.styles ?? {};
    const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = INLINE_MARKS.filter((name) => styles[name]).map((type) => ({ type }));
    const extra = Object.fromEntries(Object.entries(styles).filter(([name]) => !(INLINE_MARKS as readonly string[]).includes(name)));
    if (Object.keys(extra).length) marks.push({ type: "orbisStyle", attrs: { styles: extra } });
    if (href) marks.push({ type: "link", attrs: { href } });
    inline.text.split("\n").forEach((part, index) => {
      if (index) nodes.push({ type: "hardBreak" });
      if (part) nodes.push({ type: "text", text: part, ...(marks.length ? { marks } : {}) });
    });
  };
  value.forEach((part) => append(part));
  return nodes;
}

function nodesToInline(nodes: JSONContent[] | undefined): OrbisInline[] {
  const result: OrbisInline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") { result.push({ type: "text", text: "\n" }); continue; }
    if (node.type !== "text") continue;
    const styles: Record<string, unknown> = {};
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") href = String(mark.attrs?.href ?? "");
      else if (mark.type === "orbisStyle") Object.assign(styles, mark.attrs?.styles ?? {});
      else if ((INLINE_MARKS as readonly string[]).includes(mark.type ?? "")) styles[mark.type!] = true;
    }
    const text: OrbisInline = { type: "text", text: node.text ?? "", ...(Object.keys(styles).length ? { styles } : {}) } as OrbisInline;
    result.push(href ? { type: "link", href, content: [text] } : text);
  }
  return result;
}

function metadata(block: OrbisBlock): Record<string, unknown> { return { orbisId: block.id, orbisProps: clone(block.props) }; }
function block(id: string | undefined, type: string, props: Record<string, unknown>, content: OrbisBlock["content"], children: OrbisBlock[] = []): OrbisBlock {
  return { id: id || newBlockId(), type, props, content, children };
}
function attrs(node: JSONContent) { return node.attrs ?? {}; }
function props(node: JSONContent): Record<string, unknown> { return clone((attrs(node).orbisProps ?? {}) as Record<string, unknown>); }
function id(node: JSONContent): string | undefined { return typeof attrs(node).orbisId === "string" ? String(attrs(node).orbisId) : undefined; }

type TablePosition = { cell: JSONContent; row: number; column: number; colspan: number; rowspan: number };

/** Cell indices are not column indices when preceding cells span rows or columns. */
function tableLayout(node: JSONContent): { cells: TablePosition[]; grid: JSONContent[][]; width: number } {
  const rows = node.content ?? [];
  const grid: JSONContent[][] = rows.map(() => []);
  const cells: TablePosition[] = [];
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (grid[rowIndex][column]) column += 1;
      const colspan = Number(cell.attrs?.colspan ?? 1);
      const rowspan = Number(cell.attrs?.rowspan ?? 1);
      cells.push({ cell, row: rowIndex, column, colspan, rowspan });
      for (let rowOffset = 0; rowOffset < rowspan && rowIndex + rowOffset < rows.length; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) grid[rowIndex + rowOffset][column + columnOffset] = cell;
      }
      column += colspan;
    }
  });
  return { cells, grid, width: Math.max(0, ...grid.map((row) => row.length)) };
}

function tableAttributes(node: JSONContent): Pick<OrbisTableContent, "headerRows" | "headerCols" | "columnWidths"> {
  if (!node.content?.length) return {
    headerRows: Number(attrs(node).headerRows ?? 0),
    headerCols: Number(attrs(node).headerCols ?? 0),
    columnWidths: clone((attrs(node).columnWidths ?? []) as Array<number | null>),
  };
  const { cells, grid, width } = tableLayout(node);
  const storedRows = Number(attrs(node).headerRows ?? 0);
  const storedCols = Number(attrs(node).headerCols ?? 0);
  // Stored counts disambiguate all-header tables, provided live cell types agree.
  const storedHeadersMatch = storedRows <= grid.length && storedCols <= width && cells.every(({ cell, row, column }) =>
    (cell.type === "tableHeader") === (row < storedRows || column < storedCols),
  );
  let headerRows = 0;
  let headerCols = 0;
  if (storedHeadersMatch) {
    headerRows = storedRows;
    headerCols = storedCols;
  } else {
    while (headerRows < grid.length && grid[headerRows].length === width && grid[headerRows].every((cell) => cell?.type === "tableHeader")) headerRows += 1;
    const bodyRows = grid.slice(headerRows);
    while (headerCols < width && bodyRows.length && bodyRows.every((row) => row[headerCols]?.type === "tableHeader")) headerCols += 1;
  }
  const columnWidths: Array<number | null> = Array(width).fill(null);
  for (const { cell, column, colspan } of cells) {
    const widths = cell.attrs?.colwidth as Array<number | null> | null | undefined;
    for (let offset = 0; offset < colspan; offset += 1) {
      const value = widths?.[offset];
      if (typeof value === "number" && value > 0 && columnWidths[column + offset] === null) columnWidths[column + offset] = value;
    }
  }
  const hasWidths = columnWidths.some((value) => value !== null) || (Array.isArray(attrs(node).columnWidths) && attrs(node).columnWidths.length > 0);
  return { headerRows, headerCols, columnWidths: hasWidths ? columnWidths : [] };
}

/** The storage contract has inline cells. Preserve nested pasted block text and
 * explicit paragraph boundaries while flattening it to that existing shape. */
function cellInlineNodes(nodes: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = [];
  const isInline = (node: JSONContent) => node.type === "text" || node.type === "hardBreak";
  nodes.forEach((node, index) => {
    if (index && (!isInline(nodes[index - 1]) || !isInline(node))) result.push({ type: "hardBreak" });
    result.push(...(isInline(node) ? [node] : cellInlineNodes(node.content ?? [])));
  });
  return result;
}

function tableToNode(table: OrbisBlock, cacheMetadata = true): StoredNode {
  const data = table.content as OrbisTableContent;
  const rows = data.rows ?? [];
  const node: StoredNode = { type: "table", attrs: { ...metadata(table), headerRows: data.headerRows ?? 0, headerCols: data.headerCols ?? 0, columnWidths: data.columnWidths ?? [] }, content: rows.map((row) => ({
    type: "tableRow", content: row.cells.map((cell) => {
      const value = typeof cell === "object" && !Array.isArray(cell) ? cell.content ?? [] : cell;
      const cellProps = typeof cell === "object" && !Array.isArray(cell) ? cell.props ?? {} : {};
      return {
        type: "tableCell",
        attrs: { colspan: Number(cellProps.colspan ?? 1), rowspan: Number(cellProps.rowspan ?? 1), colwidth: null, ...(cacheMetadata ? { orbisCellOriginal: clone(cell) } : {}), orbisCellProps: clone(cellProps) },
        content: [{ type: "paragraph", content: inlineToNodes(value) }],
      };
    }),
  })) };
  for (const { cell, row, column, colspan } of tableLayout(node).cells) {
    cell.type = row < (data.headerRows ?? 0) || column < (data.headerCols ?? 0) ? "tableHeader" : "tableCell";
    const widths = (data.columnWidths ?? []).slice(column, column + colspan);
    cell.attrs!.colwidth = widths.some((width) => width !== null) ? widths : null;
  }
  return own(node, table, cacheMetadata);
}

function tableFromNode(node: JSONContent): OrbisBlock {
  const saved = original(node, "table");
  if (saved) return saved;
  const rows = (node.content ?? []).map((row) => ({ cells: (row.content ?? []).map((cell) => {
    const previous = cell.attrs?.orbisCellOriginal as OrbisTableCell | null | undefined;
    const nextNodes = cellInlineNodes(cell.content ?? []);
    const nextContent = nodesToInline(nextNodes);
    const previousCell = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : undefined;
    const previousContent = previousCell ? previousCell.content ?? [] : previous;
    const previousNodes = inlineToNodes(previousContent ?? []);
    if (previous != null && canonicalJSON(previousNodes) === canonicalJSON(nextNodes) &&
      Number(cell.attrs?.colspan ?? 1) === Number(previousCell?.props?.colspan ?? 1) &&
      Number(cell.attrs?.rowspan ?? 1) === Number(previousCell?.props?.rowspan ?? 1)) return clone(previous);
    return { type: "tableCell" as const, props: { ...((cell.attrs?.orbisCellProps ?? {}) as Record<string, unknown>), colspan: Number(cell.attrs?.colspan ?? 1), rowspan: Number(cell.attrs?.rowspan ?? 1) }, content: nextContent };
  }) }));
  const tableContent: OrbisTableContent = { type: "tableContent", rows, ...tableAttributes(node) };
  return block(id(node), "table", props(node), tableContent);
}

function listItemNode(item: OrbisBlock, cacheMetadata = true): StoredNode {
  const type = item.type === "checkListItem" ? "taskItem" : "listItem";
  return own({ type, attrs: { ...metadata(item), ...(type === "taskItem" ? { checked: Boolean(item.props.checked) } : {}) }, content: [
    { type: "paragraph", content: inlineToNodes(item.content) }, ...blocksToNodes(item.children, cacheMetadata),
  ] }, item, cacheMetadata);
}

function numberedProps(value: Record<string, unknown>, start?: number, sequenceStart?: number) {
  const actual = start ?? sequenceStart;
  if (actual !== undefined && (Object.hasOwn(value, "start") || (start !== undefined && start !== 1))) value.start = actual;
  else delete value.start;
}

function listItemBlock(item: JSONContent, type: ListBlockType, start?: number, sequenceStart?: number): OrbisBlock {
  const saved = original(item, type);
  if (saved && (type !== "numberedListItem" || start === undefined || Number(saved.props.start ?? 1) === start)) return saved;
  const itemProps = props(item);
  if (type === "checkListItem") itemProps.checked = Boolean(attrs(item).checked);
  if (type === "numberedListItem") numberedProps(itemProps, start, sequenceStart);
  return block(id(item), type, itemProps, nodesToInline(item.content?.[0]?.content), nodesToBlocks(item.content?.slice(1) ?? []));
}

type CodeFormat = { hash: string; runs: Array<{ length: number; styles?: Record<string, unknown>; href?: string }> };
function codeFormat(value: OrbisBlock["content"], text: string): CodeFormat | undefined {
  if (!Array.isArray(value)) return undefined;
  const runs: CodeFormat["runs"] = [];
  const visit = (parts: OrbisInline[], href?: string) => {
    for (const part of parts) {
      if (part.type === "link") visit(typeof part.content === "string" ? [{ type: "text", text: part.content }] : part.content, part.href);
      else runs.push({ length: part.text.length, ...(part.styles ? { styles: clone(part.styles) } : {}), ...(href ? { href } : {}) });
    }
  };
  visit(value);
  return { hash: fingerprintText(text), runs };
}
function codeContent(node: JSONContent): OrbisBlock["content"] {
  const text = (node.content ?? []).map(child => child.text ?? "").join("");
  const format = node.attrs?.orbisCodeFormat as CodeFormat | null | undefined;
  if (!format || format.hash !== fingerprintText(text) || !Array.isArray(format.runs) ||
    format.runs.some(run => !Number.isSafeInteger(run.length) || run.length < 0) || format.runs.reduce((total, run) => total + run.length, 0) !== text.length) return text;
  let offset = 0;
  return format.runs.map(run => {
    const value: OrbisInline = { type: "text", text: text.slice(offset, offset + run.length), ...(run.styles ? { styles: clone(run.styles) } : {}) };
    offset += run.length;
    return run.href ? { type: "link", href: run.href, content: [value] } : value;
  });
}

function singleNode(value: OrbisBlock, cacheMetadata = true): StoredNode {
  const meta = metadata(value);
  if (value.type === "drawing") return own({ type: "orbisDrawing", attrs: meta }, value, cacheMetadata);
  if (documentBlockDefinition(value.type)) {
    const definition = documentBlockDefinition(value.type)!;
    return own({ type: "orbisComponent", attrs: { ...meta, kind: value.type }, content: [
      ...(definition.content === "inline" ? [{ type: "paragraph", attrs: { orbisOwn: true }, content: inlineToNodes(value.content) }] : []),
      ...blocksToNodes(value.children, cacheMetadata),
    ] }, value, cacheMetadata);
  }
  if (["image", "video", "audio", "file"].includes(value.type)) return own({ type: "orbisMedia", attrs: { ...meta, kind: value.type, url: value.props.url ?? "", caption: value.props.caption ?? value.props.name ?? "" } }, value, cacheMetadata);
  if (value.type === "toggleListItem") return own({ type: "orbisToggle", attrs: meta, content: [
    { type: "orbisToggleSummary", attrs: { orbisOwn: true }, content: inlineToNodes(value.content) }, ...blocksToNodes(value.children, cacheMetadata),
  ] }, value, cacheMetadata);
  if (value.type === "table") return tableToNode(value, cacheMetadata);
  if (value.type === "quote") return own({ type: "blockquote", attrs: meta, content: [
    ...((typeof value.content === "string" ? value.content : Array.isArray(value.content) ? value.content : []).length || !value.children.length) ? [{ type: "paragraph", attrs: { orbisOwn: true }, content: inlineToNodes(value.content) }] : [],
    ...blocksToNodes(value.children, cacheMetadata),
  ] }, value, cacheMetadata);
  const codeText = inlineToNodes(value.content).map((node) => node.type === "hardBreak" ? "\n" : node.text ?? "").join("");
  const ownContent = value.type === "codeBlock" ? codeText ? [{ type: "text", text: codeText }] : [] : inlineToNodes(value.content);
  const type = value.type === "divider" ? "horizontalRule" : value.type;
  return own({ type, attrs: { ...meta, ...(type === "heading" ? { level: Number(value.props.level ?? 1) } : {}), ...(type === "codeBlock" ? { language: value.props.language ?? null, ...(!cacheMetadata ? { orbisCodeFormat: codeFormat(value.content, codeText) ?? null } : {}) } : {}) }, ...(["horizontalRule"].includes(type) ? {} : { content: ownContent }) }, value, cacheMetadata);
}

function blockToNode(value: OrbisBlock, cacheMetadata = true): StoredNode {
  if (!value.children.length || ["quote", "toggleListItem"].includes(value.type) || documentBlockDefinition(value.type) || (value.type in LIST_TYPES)) return singleNode(value, cacheMetadata);
  // Ordinary BlockNote blocks may also own nested blocks. A wrapper keeps the
  // visible children editable instead of dropping them during conversion.
  const head = { ...value, children: [] };
  const ownHead = singleNode(head, cacheMetadata);
  ownHead.attrs = { ...ownHead.attrs, orbisOwn: true };
  return own({ type: "orbisContainer", attrs: { ...metadata(value), kind: value.type }, content: [ownHead, ...blocksToNodes(value.children, cacheMetadata)] }, value, cacheMetadata);
}

function blocksToNodes(values: OrbisBlock[], cacheMetadata = true): JSONContent[] {
  const result: JSONContent[] = [];
  for (let index = 0; index < values.length;) {
    const value = values[index];
    if (!(value.type in LIST_TYPES)) { result.push(blockToNode(value, cacheMetadata)); index += 1; continue; }
    const type = value.type as ListBlockType;
    const start = type === "numberedListItem" ? Number(value.props.start ?? 1) : 1;
    const items: JSONContent[] = [];
    do {
      const current = values[index];
      if (current.type !== type) break;
      if (type === "numberedListItem" && items.length && current.props.start !== undefined && Number(current.props.start) !== start + items.length) break;
      items.push(listItemNode(current, cacheMetadata)); index += 1;
    } while (index < values.length);
    result.push({ type: LIST_TYPES[type], ...(type === "numberedListItem" ? { attrs: { start } } : {}), content: items });
  }
  return result;
}

function nodeToBlock(node: JSONContent): OrbisBlock[] {
  const type = node.type;
  if (type === "bulletList" || type === "orderedList" || type === "taskList") {
    const itemType: ListBlockType = type === "bulletList" ? "bulletListItem" : type === "orderedList" ? "numberedListItem" : "checkListItem";
    return (node.content ?? []).map((item, index) => listItemBlock(item, itemType, type === "orderedList" && index === 0 ? Number(attrs(node).start ?? 1) : undefined, type === "orderedList" ? Number(attrs(node).start ?? 1) + index : undefined));
  }
  if (type === "orbisContainer") {
    const saved = original(node);
    if (saved) return [saved];
    const [head, ...children] = node.content ?? [];
    const first = head ? nodeToBlock(head)[0] : block(id(node), String(attrs(node).kind), props(node), []);
    return [{ ...first, id: id(node) ?? first.id, props: { ...props(node), ...first.props }, children: nodesToBlocks(children) }];
  }
  if (type === "orbisComponent" || type === "orbisToggle") {
    const kind = type === "orbisToggle" ? "toggleListItem" : String(attrs(node).kind);
    const saved = original(node, kind);
    if (saved) return [saved];
    const content = node.content ?? [];
    const ownFirst = content[0]?.type === "orbisToggleSummary" || Boolean(content[0]?.attrs?.orbisOwn);
    return [block(id(node), kind, props(node), ownFirst ? nodesToInline(content[0]?.content) : [], nodesToBlocks(content.slice(ownFirst ? 1 : 0)))];
  }
  if (type === "orbisDrawing") return [original(node, "drawing") ?? block(id(node), "drawing", props(node), [])];
  if (type === "orbisMedia") {
    const kind = String(attrs(node).kind);
    const saved = original(node, kind);
    if (saved) return [saved];
    const mediaProps = props(node);
    const previousCaption = mediaProps.caption ?? mediaProps.name ?? "";
    if (Object.hasOwn(mediaProps, "caption") || attrs(node).caption !== previousCaption) mediaProps.caption = attrs(node).caption;
    return [block(id(node), kind, { ...mediaProps, url: attrs(node).url }, [])];
  }
  if (type === "table") return [tableFromNode(node)];
  if (type === "blockquote") {
    const saved = original(node, "quote");
    if (saved) return [saved];
    const content = node.content ?? [];
    const ownFirst = Boolean(content[0]?.attrs?.orbisOwn);
    return [block(id(node), "quote", props(node), ownFirst ? nodesToInline(content[0].content) : [], nodesToBlocks(content.slice(ownFirst ? 1 : 0)))];
  }
  const target = type === "horizontalRule" ? "divider" : type ?? "paragraph";
  const saved = original(node, target);
  if (saved) return [saved];
  const currentProps = props(node);
  if (type === "heading") currentProps.level = Number(attrs(node).level ?? 1);
  if (type === "codeBlock" && attrs(node).language != null) currentProps.language = attrs(node).language;
  if (type === "paragraph" || type === "heading" || type === "codeBlock" || type === "horizontalRule") {
    return [block(id(node), target, currentProps, type === "codeBlock" ? codeContent(node) : type === "horizontalRule" ? [] : nodesToInline(node.content))];
  }
  // Unknown pasted HTML is kept as editable text. Saved v2 nodes are known.
  return [block(id(node), "paragraph", {}, nodesToInline(node.content))];
}

function nodesToBlocks(nodes: JSONContent[]): OrbisBlock[] { return nodes.flatMap(nodeToBlock); }

export function toTiptapDocument(value: NoteBlocksV2, options: { cacheMetadata?: boolean } = {}): JSONContent {
  const cacheMetadata = options.cacheMetadata ?? true;
  const content = blocksToNodes(value.blocks, cacheMetadata);
  // The editor schema requires a block even before the first content save.
  // A valid empty paragraph also lets undo restore a fresh document after paste.
  return { type: "doc", content: content.length ? content : [singleNode(block(undefined, "paragraph", {}, []), cacheMetadata)] };
}

/** Collaborative schemas omit original-content caches; avoid constructing the
 * snapshots at all when inserting into that schema, including large pastes. */
export function toTiptapDocumentForSchema(value: NoteBlocksV2, schema: import("@tiptap/pm/model").Schema): JSONContent {
  return toTiptapDocument(value, { cacheMetadata: "orbisOriginal" in (schema.nodes.paragraph.spec.attrs ?? {}) });
}

// ProseMirror nodes are immutable. Retain converted siblings across edits so
// typing in one paragraph does not clone and compare every table/code block.
// Weak keys release the cached values when the document/history releases them.
const savedBlocks = new WeakMap<ProseMirrorNode, OrbisBlock[]>();

// Own-body comparisons never include descendants. The source object survives
// content-only PM edits through attrs; compute its expected signature once.
const ownSignatures = new WeakMap<OrbisBlock, Map<string, string>>();
const savedListItems = new WeakMap<ProseMirrorNode, Map<string, OrbisBlock>>();

function ownJSON(node: ProseMirrorNode, children: readonly ProseMirrorNode[]): JSONContent {
  return { type: node.type.name, attrs: node.attrs, content: children.map((child) => child.toJSON()) };
}

function ownOriginal(node: ProseMirrorNode, target: string, children: readonly ProseMirrorNode[], listType?: ListBlockType): OrbisBlock | null {
  const source = node.attrs.orbisOriginal as OrbisBlock | null | undefined;
  if (!source || source.type !== target) return null;
  const context = `${listType ?? node.type.name}:${children.length}`;
  let signatures = ownSignatures.get(source);
  if (!signatures) { signatures = new Map(); ownSignatures.set(source, signatures); }
  let expected = signatures.get(context);
  if (expected === undefined) {
    const ownSource = { ...source, children: [] };
    const ownNode = listType ? listItemNode(ownSource) : singleNode(ownSource);
    // Empty quotes with descendants have no synthetic own paragraph.
    if (node.type.name === "blockquote" && !children.length && !inlineToNodes(source.content).length) ownNode.content = [];
    expected = signature(ownNode);
    signatures.set(context, expected);
  }
  if (expected !== signature(ownJSON(node, children))) return null;
  return { ...source, children: [] };
}

function pmChildren(node: ProseMirrorNode, from = 0): OrbisBlock[] {
  const values: OrbisBlock[] = [];
  node.forEach((child, _offset, index) => { if (index >= from) values.push(...pmBlocks(child)); });
  return values;
}

function pmListItem(item: ProseMirrorNode, type: ListBlockType, start?: number, sequenceStart?: number): OrbisBlock {
  const context = `${type}:${start ?? "implicit"}:${sequenceStart ?? ""}`;
  let cache = savedListItems.get(item);
  const cached = cache?.get(context);
  if (cached) return cached;
  const head = item.firstChild;
  const own = ownOriginal(item, type, head ? [head] : [], type);
  let result: OrbisBlock;
  if (own && (type !== "numberedListItem" || start === undefined || Number(own.props.start ?? 1) === start)) {
    result = { ...own, children: pmChildren(item, 1) };
  } else {
    const itemProps = clone((item.attrs.orbisProps ?? {}) as Record<string, unknown>);
    if (type === "checkListItem") itemProps.checked = Boolean(item.attrs.checked);
    if (type === "numberedListItem") numberedProps(itemProps, start, sequenceStart);
    result = block(item.attrs.orbisId, type, itemProps, nodesToInline(head?.toJSON().content), pmChildren(item, 1));
  }
  if (!cache) { cache = new Map(); savedListItems.set(item, cache); }
  cache.set(context, result);
  return result;
}

function pmBlocks(node: ProseMirrorNode): OrbisBlock[] {
  const cached = savedBlocks.get(node);
  if (cached) return cached;
  const type = node.type.name;
  let result: OrbisBlock[];
  if (type === "bulletList" || type === "orderedList" || type === "taskList") {
    const itemType: ListBlockType = type === "bulletList" ? "bulletListItem" : type === "orderedList" ? "numberedListItem" : "checkListItem";
    result = [];
    node.forEach((item, _offset, index) => result.push(pmListItem(item, itemType, type === "orderedList" && index === 0 ? Number(node.attrs.start ?? 1) : undefined, type === "orderedList" ? Number(node.attrs.start ?? 1) + index : undefined)));
  } else if (type === "orbisContainer") {
    const head = node.firstChild;
    const own = head ? pmBlocks(head)[0] : block(node.attrs.orbisId, String(node.attrs.kind), clone(node.attrs.orbisProps ?? {}), []);
    result = [{ ...own, id: node.attrs.orbisId ?? own.id, props: { ...clone(node.attrs.orbisProps ?? {}), ...own.props }, children: pmChildren(node, 1) }];
  } else if (type === "orbisComponent" || type === "orbisToggle" || type === "blockquote") {
    const kind = type === "blockquote" ? "quote" : type === "orbisToggle" ? "toggleListItem" : String(node.attrs.kind);
    const head = node.firstChild;
    const ownFirst = head?.type.name === "orbisToggleSummary" || Boolean(head?.attrs.orbisOwn);
    const originalBody = ownOriginal(node, kind, ownFirst && head ? [head] : []);
    const own = originalBody ?? block(node.attrs.orbisId, kind, clone(node.attrs.orbisProps ?? {}), ownFirst ? nodesToInline(head?.toJSON().content) : []);
    result = [{ ...own, children: pmChildren(node, ownFirst ? 1 : 0) }];
  } else {
    // Tables and ordinary leaf blocks own their complete body. Only a changed
    // leaf reaches this conversion; containers never serialize their subtree.
    result = nodeToBlock(node.toJSON());
  }
  savedBlocks.set(node, result);
  return result;
}

const emptyDocuments=new WeakMap<ProseMirrorNode,OrbisBlock>();
export function fromTiptapDocument(value: JSONContent | ProseMirrorNode): NoteBlocksV2 {
  const blocks: OrbisBlock[] = [];
  if (value instanceof ProseMirrorNode) {
    value.forEach((node) => {
      blocks.push(...pmBlocks(node));
    });
  } else {
    blocks.push(...nodesToBlocks(value.content ?? []));
  }
  if(!blocks.length){
    // The same immutable empty document must keep its insertion anchor.
    const placeholder=value instanceof ProseMirrorNode?emptyDocuments.get(value):undefined;
    const initial=placeholder??block(undefined,"paragraph",{},[]);
    if(value instanceof ProseMirrorNode&&!placeholder)emptyDocuments.set(value,initial);
    blocks.push(initial);
  }
  return { schema_version: 2, editor: "blocknote", blocks };
}
