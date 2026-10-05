/** Clipboard data includes authored properties, never IDs or source snapshots. */
const EDITABLE_PROPS = new Set([
  "scene", "title", "href", "tone", "columns", "url", "name", "caption", "previewWidth", "showPreview",
  "textAlignment", "textColor", "backgroundColor", "level", "checked", "language", "start", "isToggleable",
  "colspan", "rowspan",
]);

export function clipboardProps(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => EDITABLE_PROPS.has(key) &&
    (typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item))));
}

export function parseClipboardProps(element: HTMLElement, attribute = "data-orbis-props") {
  try { return clipboardProps(JSON.parse(element.getAttribute(attribute) ?? "{}")); }
  catch { return {}; }
}

export function clipboardPropsAttribute(value: unknown, attribute = "data-orbis-props") {
  const props = clipboardProps(value);
  return Object.keys(props).length ? { [attribute]: JSON.stringify(props) } : {};
}
