import { describe, expect, it } from "vitest";
import { cellText, newField, parseCell } from "./model";
describe("sheet clipboard values", () => {
  it("uses UTC+8 for unzoned date cells and preserves configured formatting", () => {
    const f = { ...newField("datetime"), date_format: "YYYY-MM-DD" };
    const value = parseCell(f, "2026-10-21");
    expect(value).toBe(Date.parse("2026-10-20T16:00:00Z"));
    expect(cellText(f, value)).toBe("2026-10-21");
    expect(cellText({ ...f, date_format: "YYYY/MM/DD" }, value)).toBe(
      "2026/10/21",
    );
  });
  it("resolves option labels and refuses silent replacement by invalid options", () => {
    const f = newField("select");
    expect(parseCell(f, "进行中")).toBe(f.options[1].id);
    expect(() => parseCell(f, "未知选项")).toThrow();
    expect(() => parseCell(newField("created_by"), "someone")).toThrow();
  });
});
