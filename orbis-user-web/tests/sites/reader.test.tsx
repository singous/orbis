import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteReader } from "../../src/features/sites/SiteReader";
import type { SiteSnapshot } from "../../src/features/sites/schemas";

const snapshot: SiteSnapshot = {
  name: "Orbis 开发者文档",
  slug: "developer",
  description: "从接入到上线，完整了解 Orbis。",
  site_kind: "handbook",
  accent_color: "#176b45",
  release_id: "release-7",
  release_number: 7,
  published_at_ms: 1_789_344_000_000,
  branding: {
    logo_url: null,
    links: [{ label: "API 文档", url: "https://example.com/api" }],
    footer_links: [{ label: "状态", url: "https://status.example.com" }],
    cta: { label: "打开 Orbis", url: "https://example.com" },
    theme: "system",
  },
  redirects: { "old-deploy": "deploy" },
  pages: [
    {
      slug: "start",
      title: "开始使用",
      group: "指南",
      section: "文档",
      parent_slug: null,
      description: "先理解核心概念，再完成第一次发布。",
      updated_at_ms: 1_789_344_000_000,
      plain_text: "核心概念和快速开始",
      blocks: { schema_version: 2, blocks: [{ id: "p", type: "paragraph", content: "核心概念和快速开始", children: [] }] },
    },
    {
      slug: "deploy",
      title: "部署到生产环境",
      group: "指南",
      section: "文档",
      parent_slug: "start",
      description: "发布一个可供团队访问的站点。",
      updated_at_ms: 1_789_430_400_000,
      plain_text: "配置域名并生成独立版本，完成生产发布。",
      blocks: { schema_version: 2, blocks: [{ id: "h", type: "heading", props: { level: 2 }, content: "配置域名", children: [] }] },
    },
    {
      slug: "security",
      title: "访问控制",
      group: "安全",
      section: "API",
      parent_slug: null,
      description: "定义谁可以阅读文档。",
      updated_at_ms: null,
      plain_text: "使用访问令牌保护私有内容。",
      blocks: { schema_version: 2, blocks: [{ id: "s", type: "paragraph", content: "使用访问令牌保护私有内容。", children: [] }] },
    },
  ],
};

const originalMatchMedia = window.matchMedia;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

function LocationProbe() {
  return <output aria-label="当前路径">{useLocation().pathname}</output>;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("Mint-style site reader", () => {
  it("opens search from Cmd/Ctrl+K and supports keyboard selection", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/s/developer"]}>
        <Routes>
          <Route path="/s/developer/:pageSlug?" element={<><SiteReader snapshot={snapshot} basePath="/s/developer" /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "搜索文档" });
    expect(dialog).toBeVisible();
    const search = within(dialog).getByRole("combobox", { name: "搜索文档" });
    expect(search).toHaveFocus();

    await user.type(search, "部署");
    const option = within(dialog).getByRole("option", { name: /部署到生产环境/ });
    expect(option).toHaveTextContent("文档 / 指南 / 开始使用");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.queryByRole("dialog", { name: "搜索文档" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/s/developer/deploy");
  });

  it("keeps selection keys on the search input and preserves native button activation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/s/developer"]}>
        <Routes>
          <Route path="/s/developer/:pageSlug?" element={<><SiteReader snapshot={snapshot} basePath="/s/developer" /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "搜索文档" }));
    const dialog = screen.getByRole("dialog", { name: "搜索文档" });
    const input = within(dialog).getByRole("combobox", { name: "搜索文档" });
    await user.type(input, "使用");
    const options = within(dialog).getAllByRole("option");
    expect(options).toHaveLength(2);

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/s/developer");

    options[1].focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "搜索文档" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/s/developer/security");
  });

  it("moves through multiple search results with arrow keys and scrolls the active option into view", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    render(
      <MemoryRouter initialEntries={["/s/developer"]}>
        <Routes>
          <Route path="/s/developer/:pageSlug?" element={<><SiteReader snapshot={snapshot} basePath="/s/developer" /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "搜索文档" }));
    const input = screen.getByRole("combobox", { name: "搜索文档" });
    await user.type(input, "使用");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/s/developer/security");
  });

  it("lets a tabbed close button handle Enter without opening a search result", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/s/developer"]}>
        <Routes>
          <Route path="/s/developer/:pageSlug?" element={<><SiteReader snapshot={snapshot} basePath="/s/developer" /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "搜索文档" }));
    await user.type(screen.getByRole("combobox", { name: "搜索文档" }), "部署");
    await user.tab();
    expect(screen.getByRole("button", { name: "关闭搜索" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "搜索文档" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/s/developer");
  });

  it("shows section-first search paths without repeating identical labels", async () => {
    const user = userEvent.setup();
    const repeatedLabelSnapshot = {
      ...snapshot,
      pages: snapshot.pages.map((page) => page.slug === "deploy" ? { ...page, section: "指南" } : page),
    };
    render(<MemoryRouter><SiteReader snapshot={repeatedLabelSnapshot} basePath="/s/developer" /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "搜索文档" }));
    await user.type(screen.getByRole("combobox", { name: "搜索文档" }), "部署");
    const result = screen.getByRole("option", { name: /部署到生产环境/ });
    expect(result).toHaveTextContent("指南 / 开始使用");
    expect(result).not.toHaveTextContent("指南 / 指南");
  });

  it("closes search with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/developer" /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "搜索文档" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "搜索文档" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders nested navigation while keeping parent documents readable", () => {
    render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/developer" pageSlug="deploy" /></MemoryRouter>);
    const navigation = screen.getByRole("navigation", { name: "站点导航" });
    expect(within(navigation).getByRole("link", { name: "开始使用" })).toHaveAttribute("href", "/s/developer/start");
    expect(within(navigation).getByRole("link", { name: "部署到生产环境" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "面包屑" })).toHaveTextContent("文档开始使用部署到生产环境");
    expect(screen.getByText("发布一个可供团队访问的站点。")).toBeInTheDocument();
  });

  it("redirects old published paths to their current page", () => {
    render(
      <MemoryRouter initialEntries={["/s/developer/old-deploy"]}>
        <Routes>
          <Route path="/s/developer/:pageSlug?" element={<><SiteReader snapshot={snapshot} basePath="/s/developer" pageSlug="old-deploy" /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("当前路径")).toHaveTextContent("/s/developer/deploy");
  });

  it("renders malformed unknown paths as missing pages instead of decoding them again", () => {
    const malformedSnapshot = { ...snapshot, redirects: {} };
    expect(() => render(<MemoryRouter><SiteReader snapshot={malformedSnapshot} basePath="/s/developer" pageSlug="%" /></MemoryRouter>)).not.toThrow();
    expect(screen.getByRole("heading", { name: "页面不存在" })).toBeInTheDocument();
  });

  it("traps focus in the mobile navigation drawer and restores the menu trigger on Escape", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({ matches: query.includes("max-width"), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/developer" /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "打开站点导航" });
    await user.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "站点导航抽屉" });
    expect(within(drawer).getByRole("link", { name: "开始使用" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "站点导航抽屉" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("button", { name: "复制链接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制页面" })).toBeInTheDocument();
  });

  it("announces clipboard success only after the browser write completes", async () => {
    const user = userEvent.setup();
    let finishWrite: (() => void) | undefined;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/developer" /></MemoryRouter>);
    const copyLink = screen.getByRole("button", { name: "复制链接" });
    await user.click(copyLink);
    expect(copyLink).toHaveAccessibleName("复制链接");
    expect(screen.queryByText("链接已复制")).not.toBeInTheDocument();
    finishWrite?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "链接已复制" })).toBeInTheDocument());
  });

  it("reports unavailable and rejected clipboard writes without claiming success", async () => {
    const user = userEvent.setup();
    Reflect.deleteProperty(navigator, "clipboard");
    render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/developer" /></MemoryRouter>);
    const copyLink = screen.getByRole("button", { name: "复制链接" });
    const copyPage = screen.getByRole("button", { name: "复制页面" });
    await user.click(copyLink);
    expect(screen.getByRole("status")).toHaveTextContent("请从地址栏手动复制");
    expect(copyLink).toHaveAccessibleName("复制链接");

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await user.click(copyPage);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("请检查浏览器权限后重试"));
    expect(copyPage).toHaveAccessibleName("复制页面");
  });

  it("uses the published system theme and lets readers select an explicit theme", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    const { container } = render(<MemoryRouter><SiteReader snapshot={snapshot} basePath="/s/developer" /></MemoryRouter>);
    const reader = container.querySelector(".site-reader");
    expect(reader).toHaveAttribute("data-theme", "dark");
    expect(reader).toHaveAttribute("data-theme-mode", "system");

    await user.click(screen.getByRole("button", { name: "当前跟随系统主题，切换为浅色主题" }));
    expect(reader).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("orbis-reader-theme")).toBe("light");
  });
});
