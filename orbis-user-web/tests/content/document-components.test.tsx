import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ContentRenderer } from "../../src/features/content/ContentRenderer";
import { extractPlainTextV2, v2ToMarkdown, type OrbisBlock } from "../../src/features/notes/block-model";

let sequence = 0;
function block(type: string, props: Record<string, unknown> = {}, children: OrbisBlock[] = [], content = ""): OrbisBlock {
  return { id: `component-${sequence++}`, type, props, children, content };
}
const doc = (...blocks: OrbisBlock[]) => ({ schema_version: 2, editor: "blocknote", blocks });
afterEach(() => { cleanup(); window.history.replaceState(window.history.state, "", "/"); });

describe("documentation content", () => {
  it("renders authored callout and card titles with safe navigable links", () => {
    render(<ContentRenderer blocks={doc(
      block("callout", { title: "注意事项", tone: "warning" }, [], "请先备份"),
      block("cardGroup", { columns: 2 }, [block("card", { title: "快速开始", href: "https://example.com/start" }, [block("paragraph", {}, [], "安装与配置")])]),
    )} />);
    expect(screen.getByRole("note", { name: "注意事项" })).toHaveTextContent("请先备份");
    expect(screen.getByRole("link", { name: "快速开始" })).toHaveAttribute("href", "https://example.com/start");
    expect(screen.getByText("安装与配置")).toBeVisible();
  });

  it("switches tab content using pointer and arrow keys without losing hidden text", async () => {
    const user = userEvent.setup();
    render(<ContentRenderer blocks={doc(block("tabs", {}, [
      block("tab", { title: "Linux" }, [block("paragraph", {}, [], "Linux 配置说明")]),
      block("tab", { title: "macOS" }, [block("paragraph", {}, [], "Mac 配置说明")]),
    ]))} />);
    expect(screen.getByText("Linux 配置说明")).toBeVisible();
    expect(screen.getByText("Mac 配置说明")).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: "macOS" }));
    expect(screen.getByText("Mac 配置说明")).toBeVisible();
    expect(screen.getByRole("tab", { name: "macOS" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Linux" })).toHaveFocus();
    expect(screen.getByText("Linux 配置说明")).toBeVisible();
  });

  it("renders numbered steps and copies the active highlighted code as literal text", async () => {
    const user = userEvent.setup();
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    const { container } = render(<ContentRenderer blocks={doc(
      block("steps", {}, [block("step", { title: "安装" }, [block("paragraph", {}, [], "安装依赖")])]),
      block("codeGroup", {}, [block("codeBlock", { language: "python" }, [], "import orbis"), block("codeBlock", { language: "javascript" }, [], 'const html = "<script>bad()</script>";')]),
    )} />);
    expect(screen.getByRole("list", { name: "步骤" })).toHaveTextContent("安装依赖");
    await user.click(screen.getByRole("tab", { name: "JavaScript" }));
    await user.click(screen.getByRole("button", { name: "复制代码" }));
    expect(copied).toBe('const html = "<script>bad()</script>";');
    await waitFor(() => expect(container.querySelector(".hljs-keyword")).not.toBeNull());
    expect(container.querySelector("script")).toBeNull();
  });

  it("exports component titles, links and every tab to readable Markdown and search text", () => {
    const blocks = [block("card", { title: "文档入口", href: "https://example.com/docs" }, [block("paragraph", {}, [], "阅读指南")]), block("tabs", {}, [block("tab", { title: "Python" }, [block("paragraph", {}, [], "Python 内容")]), block("tab", { title: "JavaScript" }, [block("paragraph", {}, [], "JS 内容")])])];
    const markdown = v2ToMarkdown(blocks);
    const plain = extractPlainTextV2(blocks);
    for (const value of ["文档入口", "阅读指南", "Python", "Python 内容", "JavaScript", "JS 内容"]) {
      expect(markdown).toContain(value);
      expect(plain).toContain(value);
    }
    expect(markdown).toContain("https://example.com/docs");
  });
});
