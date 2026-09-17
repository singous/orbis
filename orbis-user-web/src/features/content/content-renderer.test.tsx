import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContentRenderer, contentOutline, safeContentUrl } from "./ContentRenderer";

describe("published content rendering", () => {
  it("renders native ordered starts, middle restarts, and nested lists independently", () => {
    const item = (content: string, start?: number, children: unknown[] = []) => ({
      type: "numberedListItem", props: start === undefined ? {} : { start }, content, children,
    });
    const { container } = render(<ContentRenderer blocks={{ schema_version: 2, blocks: [
      item("Seven", 7, [{ type: "paragraph", content: "Continuation" }, { type: "bulletListItem", content: "Bullet" },
        item("Nested three", 3), item("Nested four"), item("Nested ten", 10), item("Nested eleven")]),
      item("Eight"), item("Twenty", 20), item("Twenty one"), { type: "paragraph", content: "Break" }, item("One"),
    ] }} />);
    const lists = Array.from(container.querySelectorAll("ol"));
    const displayedNumbers = lists.map((list) => {
      let next = list.start;
      return Array.from(list.children).map((entry) => {
        if (entry.hasAttribute("value")) next = Number(entry.getAttribute("value"));
        return next++;
      });
    });
    expect(displayedNumbers).toEqual([[7, 8, 20, 21], [3, 4, 10, 11], [1]]);
    expect(lists[0]).toHaveAttribute("start", "7");
    expect(lists[0].children[2]).toHaveAttribute("value", "20");
    expect(container.querySelector("ul")).toHaveTextContent("Bullet");
    expect(lists[0]).toHaveTextContent("Continuation");
  });

  it("retains legacy ordered-list and nested-list starts", () => {
    const { container } = render(<ContentRenderer blocks={{ schema_version: 1, doc: { type: "doc", content: [
      { type: "orderedList", attrs: { start: 7 }, content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "Seven" }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Three" }] }] }] },
      ] }] },
    ] } }} />);
    expect(Array.from(container.querySelectorAll("ol"), (list) => list.start)).toEqual([7, 3]);
  });

  it("keeps nested heading content visible with matching outline links", () => {
    const blocks = { schema_version: 2, blocks: [{ type: "heading", props: { level: 2 }, content: "父标题", children: [
      { type: "paragraph", content: "缩进正文" }, { type: "heading", props: { level: 3 }, content: "子标题" },
    ] }] };
    render(<ContentRenderer blocks={blocks} />);
    expect(screen.getByText("缩进正文")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "子标题" })).toHaveAttribute("id", "heading-0-1");
    expect(contentOutline(blocks)).toContainEqual({ id: "heading-0-1", text: "子标题", level: 3 });
  });

  it("preserves old two-dimensional tables and native merged cells", () => {
    const blocks = { schema_version: 2, blocks: [
      { type: "table", content: [["旧表格", [{ type: "text", text: "原列" }]], ["第二行", "值"]] },
      { type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: [{ type: "tableCell", props: { colspan: 2 }, content: "合并表头" }] }, { cells: ["左", "右"] }] } },
    ] };
    render(<ContentRenderer blocks={blocks} />);
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.getByRole("cell", { name: "原列" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "合并表头" })).toHaveAttribute("colspan", "2");
  });
  it("renders a legacy table as a table with its formatted content", () => {
    render(<ContentRenderer blocks={{ schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "安装指南" }] },
      { type: "table", content: [{ type: "tableRow", content: [
        { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "环境" }] }] },
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "本地", marks: [{ type: "bold" }] }] }] },
      ] }] },
    ] } }} />);
    expect(screen.getByRole("heading", { name: "安装指南" })).toHaveAttribute("id", "heading-0");
    expect(screen.getByRole("table")).toHaveTextContent("环境本地");
    expect(screen.getByText("本地").closest("strong")).not.toBeNull();
  });

  it("renders native BlockNote tables and nested headings with stable outline anchors", () => {
    const blocks = { schema_version: 2 as const, editor: "blocknote" as const, blocks: [
      { id: "intro", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "开始使用" }], children: [] },
      { id: "table", type: "table", props: {}, content: { type: "tableContent", headerRows: 1, rows: [
        { cells: [[{ type: "text", text: "名称" }], [{ type: "text", text: "内容" }]] },
        { cells: [[{ type: "text", text: "Orbis" }], { type: "tableCell", content: [{ type: "text", text: "团队知识", styles: { bold: true } }] }] },
      ] }, children: [] },
    ] };
    render(<ContentRenderer blocks={blocks} />);
    expect(screen.getByRole("table")).toHaveTextContent("名称内容Orbis团队知识");
    expect(screen.getByRole("columnheader", { name: "名称" })).toBeInTheDocument();
    expect(contentOutline(blocks)).toEqual([{ id: "heading-0", text: "开始使用", level: 2 }]);
  });

  it("renders code literally and does not turn unsafe links or media into executable URLs", () => {
    const blocks = { schema_version: 2 as const, editor: "blocknote" as const, blocks: [
      { id: "code", type: "codeBlock", props: { language: "html" }, content: "<script>bad()</script>", children: [] },
      { id: "link", type: "paragraph", props: {}, content: [{ type: "link", href: "javascript:bad()", content: [{ type: "text", text: "危险链接" }] }], children: [] },
      { id: "image", type: "image", props: { url: "data:text/html,bad", caption: "附件" }, content: [], children: [] },
    ] };
    const { container } = render(<ContentRenderer blocks={blocks} />);
    expect(screen.getByText("<script>bad()</script>")).toBeInTheDocument();
    expect(screen.getByText("危险链接").closest("a")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(safeContentUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(safeContentUrl("//evil.example")).toBeNull();
  });
});
