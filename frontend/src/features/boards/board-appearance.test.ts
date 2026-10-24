import { expect, it } from "vitest";
import { boardCanvasBackground, boardCanvasTextColor, boardElementStyle } from "./board-appearance";
import { makeElement } from "./model";

it("uses the application canvas token for existing default backgrounds in either theme", () => {
  expect(boardCanvasBackground("#f2f4f7")).toBe("var(--board-canvas)");
  expect(boardCanvasBackground("#F2F4F7")).toBe("var(--board-canvas)");
  expect(boardCanvasTextColor("#f2f4f7")).toBe("var(--text-primary)");
});

it("renders legacy neutral mindmap branches on the themed canvas and preserves authored colors", () => {
  for (const shape of ["mindmap.topic", "mindmap.subtopic"]) {
    const node = makeElement(shape, crypto.randomUUID(), 20, 40);
    expect(boardElementStyle(node, "#f8fafc")).toMatchObject({
      fill: "transparent",
      text_color: "#f8fafc",
    });
    expect(node.style.fill).toBe("#ffffff");
    node.style.fill = "#dbeafe";
    node.style.text_color = "#5b21b6";
    expect(boardElementStyle(node, "#f8fafc")).toBe(node.style);
    expect(boardElementStyle(node, "#f8fafc")).toMatchObject({
      fill: "#dbeafe",
      text_color: "#5b21b6",
    });
  }
});

it("preserves authored colors and transparency without rewriting board data", () => {
  for (const value of ["#ffffff", "#123456", "transparent"]) {
    expect(boardCanvasBackground(value)).toBe(value);
    expect(boardCanvasTextColor(value)).toBe("#1e293b");
  }
});
