import { expect, it } from "vitest";
import { decodeCells, encodeCells } from "./clipboard";
it("round-trips quoted multiline cells without losing text", () => {
  const rows = [
    ["one\ttwo", "a\nb", 'a "quote"'],
    ["", "x", ""],
  ];
  expect(decodeCells(encodeCells(rows))).toEqual(rows);
  expect(decodeCells("a\tb\r\nc\td\r\n")).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
});
it("rejects oversized or malformed clipboard batches before mutation", () => {
  expect(() => decodeCells('"open')).toThrow();
  expect(() => decodeCells(Array(201).fill("row").join("\n"))).toThrow();
});
