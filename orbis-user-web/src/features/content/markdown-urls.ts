/** CommonMark destination escaping, shared with the API's markdown_urls.py. */
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
