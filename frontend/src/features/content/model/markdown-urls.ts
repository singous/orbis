/** Recognize destinations that can be persisted through the native link contract. */
export function supportedMarkdownHref(value: string): boolean {
  // Match the native content contract before turning literal source into a link.
  // Unsupported destinations must stay visible instead of blocking the paste save.
  const asset = /^(?:asset|orbis-file):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(value);
  if (asset) return asset[1] !== "00000000-0000-0000-0000-000000000000";
  if (/[\u0000\r\n\t\\]/.test(value) || value.trim() !== value || /%(?![0-9a-f]{2})/i.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (!/^(?:https?|mailto):/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || /^https?:\/\/[^/?#]*@/.test(value)) return false;
    if (url.protocol === "mailto:") return !url.host && Boolean(url.pathname) && !url.pathname.startsWith("/");
    return Boolean(url.hostname);
  } catch { return false; }
}

/** CommonMark destination escaping for document Markdown conversion. */
export function markdownDestination(value: string): string {
  return Array.from(value, (character) => {
    if ("\\()".includes(character)) return "\\" + character;
    const point = character.codePointAt(0)!;
    if (point <= 32 || point === 127 || character === "<" || character === ">") return encodeURIComponent(character);
    return character;
  }).join("");
}

/** Use a longer fence than any run in the literal source. */
export function markdownCodeFence(source: string, language: string): string {
  let width = 3;
  for (const match of source.matchAll(/`+/g)) width = Math.max(width, match[0].length + 1);
  const fence = "`".repeat(width);
  const info = language.replace(/[`\u0000-\u001f\u007f]/g, "").trim();
  return `${fence}${info}\n${source}\n${fence}`;
}
