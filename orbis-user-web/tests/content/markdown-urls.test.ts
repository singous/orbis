import { marked } from "marked";
import { expect, it } from "vitest";
import { v2ToMarkdown, type OrbisBlock } from "../../src/features/notes/block-model";
import { markdownDestination } from "../../src/features/content/markdown-urls";
import { tiptapDocToMarkdown } from "../../src/features/notes/markdown-contract";

it("preserves a card URL with Markdown destination punctuation", async () => {
  const blocks: OrbisBlock[] = [{ id: "card", type: "card", props: { title: "Guide", href: "https://example.com/guide)" }, content: [], children: [] }];
  const document = new DOMParser().parseFromString(await marked.parse(v2ToMarkdown(blocks)), "text/html");
  expect(document.querySelector("a")?.getAttribute("href")).toBe("https://example.com/guide)");
});

it("matches the shared Python encoding contract without modifying ordinary URLs", () => {
  expect(markdownDestination("https://example.com/a)b(c\\d e<z>\n")).toBe("https://example.com/a\\)b\\(c\\\\d%20e%3Cz%3E%0A");
  expect(markdownDestination("https://example.com/中文?q=hello%20world&mode=read")).toBe("https://example.com/中文?q=hello%20world&mode=read");
});

it("keeps media destinations and captions in exported Markdown", async () => {
  const blocks: OrbisBlock[] = [{ id: "image", type: "image", props: { caption: "图示 [注释]", url: "https://example.com/image).png" }, content: [], children: [] }];
  const document = new DOMParser().parseFromString(await marked.parse(v2ToMarkdown(blocks)), "text/html");
  expect(document.querySelector("img")?.getAttribute("src")).toBe("https://example.com/image).png");
  expect(document.querySelector("img")?.getAttribute("alt")).toBe("图示 [注释]");
});

it.each(["v1", "v2"])("retains literal code with embedded fences in %s exports", async (version) => {
  const source = "```js\nconst path = 'a\\\\b | c';\n```\n";
  const markdown = version === "v2" ? v2ToMarkdown([{ id: "code", type: "codeBlock", props: { language: "markdown\n```injected" }, content: source, children: [] }])
    : tiptapDocToMarkdown({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "markdown\n```injected" }, content: [{ type: "text", text: source }] }] });
  const document = new DOMParser().parseFromString(await marked.parse(markdown), "text/html");
  expect(document.querySelectorAll("pre")).toHaveLength(1);
  expect(document.querySelector("code")?.textContent).toBe(source);
  expect(markdown).toMatch(/^````markdowninjected\n/);
});
