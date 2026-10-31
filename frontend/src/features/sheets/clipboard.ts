const MAX_CLIPBOARD_BYTES = 1 << 20;
export function encodeCells(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) =>
          /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
        )
        .join("\t"),
    )
    .join("\n");
}
export function decodeCells(text: string): string[][] {
  if (text.length > MAX_CLIPBOARD_BYTES)
    throw new Error("粘贴内容超过 1 MiB，请分批粘贴");
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted || !value) quoted = !quoted;
      else value += ch;
    } else if (!quoted && (ch === "\t" || ch === "\n" || ch === "\r")) {
      row.push(value);
      value = "";
      if (ch !== "\t") {
        rows.push(row);
        row = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
      }
    } else value += ch;
  }
  if (quoted) throw new Error("粘贴内容的引号未闭合");
  if (value || row.length || !rows.length) {
    row.push(value);
    rows.push(row);
  }
  if (rows.length > 200 || rows.some((row) => row.length > 128))
    throw new Error("每次最多粘贴 200 行、128 列");
  return rows;
}
