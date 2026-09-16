import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SiteReader } from "./SiteReader";

export const readerSnapshot = {
  name: "Orbis 使用手册", slug: "orbis-guide", description: "把团队知识写下来，让每个人都能找到答案。",
  site_kind: "handbook" as const, accent_color: "#0f766e", release_id: "release-1", release_number: 1, published_at_ms: 1789440000000,
  pages: [
    { slug: "welcome", title: "欢迎使用", group: "开始使用", plain_text: "记录知识 共同成长", blocks: { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "记录知识" }] }, { type: "paragraph", content: [{ type: "text", text: "共同成长" }] }] } } },
    { slug: "publish", title: "发布站点", group: "内容管理", plain_text: "发布后生成独立版本", blocks: { schema_version: 1, editor: "tiptap", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "发布后生成独立版本" }] }] } } },
  ],
};

describe("SiteReader", () => {
  it("shows a matching leading document heading once and keeps later outline anchors valid", () => {
    const snapshot = { ...readerSnapshot, pages: [{ ...readerSnapshot.pages[0], title: "记录知识" }] };
    render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/orbis-guide" /></MemoryRouter>);
    expect(screen.getAllByRole("heading", { name: "记录知识" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "记录知识" })).not.toHaveAttribute("href", "#heading-0");
    expect(screen.getByText("共同成长", { exact: true })).toBeInTheDocument();
  });
  it("provides published navigation, outline anchors and next-page links", () => {
    render(<MemoryRouter><SiteReader snapshot={readerSnapshot} basePath="/s/orbis-guide" /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "欢迎使用", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "记录知识" }).some((link) => link.getAttribute("href") === "#heading-0")).toBe(true);
    expect(screen.getByRole("link", { name: /下一篇.*发布站点/ })).toHaveAttribute("href", "/s/orbis-guide/publish");
    expect(screen.queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
  });

  it("searches only the supplied published pages and offers a keyboard-ready result", async () => {
    render(<MemoryRouter><SiteReader snapshot={readerSnapshot} basePath="/s/orbis-guide" /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "搜索文档" }));
    const searchbox = screen.getByRole("combobox", { name: "搜索文档" });
    await userEvent.type(searchbox, "独立版本");
    expect(screen.getByRole("option", { name: /发布站点.*发布后生成独立版本/ })).toBeInTheDocument();
    await userEvent.clear(searchbox);
    await userEvent.type(searchbox, "未发布秘密");
    expect(screen.getByText("没有找到相关内容")).toBeInTheDocument();
  });

  it("shows a missing-page state instead of silently selecting a different page", () => {
    render(<MemoryRouter><SiteReader snapshot={readerSnapshot} basePath="/s/orbis-guide" pageSlug="missing" /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回文档首页" })).toHaveAttribute("href", "/s/orbis-guide");
  });

  it("allows narrow-screen navigation and a dark reading theme", async () => {
    const { container } = render(<MemoryRouter><SiteReader snapshot={readerSnapshot} basePath="/s/orbis-guide" /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "打开站点导航" }));
    expect(screen.getByRole("button", { name: "关闭站点导航" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "切换深色主题" }));
    expect(container.querySelector(".site-reader")).toHaveAttribute("data-theme", "dark");
  });
});
