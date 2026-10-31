import { afterEach, expect, it, vi } from "vitest";
import { exportSVG } from "./export";
import { makeElement } from "./model";

afterEach(() => vi.restoreAllMocks());

it("exports the same mindmap cards, underlines and authored colors as the canvas", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as CanvasRenderingContext2D);
  const page = crypto.randomUUID();
  const root = makeElement("mindmap.root", page, 20, 100);
  root.style.fill = "#7162b6";
  root.style.text_color = "#ffffff";
  const branch = makeElement("mindmap.topic", page, 250, 100);
  const custom = makeElement("mindmap.subtopic", page, 500, 100);
  custom.style.fill = "#dbeafe";
  custom.style.text_color = "#5b21b6";
  const original = JSON.stringify([root, branch, custom]);
  const xml = new DOMParser().parseFromString(await exportSVG([root, branch, custom]), "image/svg+xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  const lines = [...xml.querySelectorAll('path[d="M0 100H100"]')];
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line.getAttribute("fill")).toBe("none");
    expect(line.getAttribute("stroke-linejoin")).toBe("round");
  }
  expect(xml.querySelector('path[fill="#7162b6"]')?.getAttribute("d")).toContain("Q");
  expect(xml.querySelector('rect[rx="6"]')?.getAttribute("fill")).toBe("#dbeafe");
  expect(xml.querySelector('text[fill="#5b21b6"]')).not.toBeNull();
  expect(JSON.stringify([root, branch, custom])).toBe(original);
});
