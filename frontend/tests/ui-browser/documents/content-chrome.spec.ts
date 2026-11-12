import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { readContrasts } from "../fixtures/contrast";

async function capture(page: Page, theme: string, width: number, state: string) {
  if (!process.env.ORBIS_CONTENT_EVIDENCE) return;
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
  });
  const values = await page.locator('[data-testid="content-preview"]').evaluate(element => [element.querySelector(".document-prose")!, ...element.querySelectorAll(".doc-callout,.doc-callout-title,.doc-tabs-list,.doc-tabs-list button,.doc-tab-panel,.content-code,.content-code-toolbar,.content-code-toolbar button,.content-code pre,.hljs-keyword,.hljs-string,.hljs-number,.hljs-comment")].map(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return { tag: node.tagName, className: node.className.split(" ")[0], text: node.textContent?.slice(0, 20), x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, color: style.color, background: style.backgroundColor, border: style.border, padding: style.padding, margin: style.margin, gap: style.gap, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, shadow: style.boxShadow };
  }));
  appendFileSync(process.env.ORBIS_CONTENT_EVIDENCE, JSON.stringify({ theme, width, state, values }) + "\n");
}

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test(`published content ${theme} ${width}px keeps tabs, copy and authored styles`, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/login");
  await page.evaluate(async () => {
    const main = await (await fetch("/src/main.tsx")).text();
    const reactURL = main.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = main.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const rendererURL = "/src/features/content/ContentRenderer.tsx";
    const [{ default: React }, { default: ReactDOM }, { ContentRenderer }] = await Promise.all([import(reactURL), import(domURL), import(rendererURL)]);
    const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
    const source = 'const count = 1; // 保留代码注释\nconsole.log("hello");';
    const blocks = { schema_version: 2, editor: "blocknote", blocks: [
      { id: "notice", type: "callout", props: { title: "说明标题", tone: "info" }, content: [], children: [paragraph("notice-text", "保留提示正文")] },
      { id: "tabs", type: "tabs", props: {}, content: [], children: [
        { id: "tab-a", type: "tab", props: { title: "第一个标签" }, content: [], children: [paragraph("first", "第一段内容")] },
        { id: "tab-b", type: "tab", props: { title: "第二个标签" }, content: [], children: [{ id: "public-1-1-0", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "第二个标签标题", styles: {} }], children: [] }, paragraph("second", "第二段内容")] },
      ] },
      { id: "code", type: "codeBlock", props: { language: "javascript" }, content: source, children: [] },
    ] };
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.dataset.testid = "content-preview";
    host.style.padding = "24px";
    document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(ContentRenderer, { blocks }));
  });
  const host = page.getByTestId("content-preview");
  await expect(host).toContainText("保留提示正文");
  await expect(host.locator(".hljs-comment")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const contrasts = await readContrasts(host, [".doc-callout-title", ".content-code pre code", ".hljs-keyword", ".hljs-string", ".hljs-number", ".hljs-comment"]);
  if (process.env.ORBIS_CONTENT_CONTRAST) appendFileSync(process.env.ORBIS_CONTENT_CONTRAST, JSON.stringify({ theme, width, contrasts }) + "\n");
  for (const item of contrasts) expect(item.ratio, `${theme} ${item.selector}: ${item.color} on ${item.background}`).toBeGreaterThanOrEqual(4.5);
  await capture(page, theme, width, "initial");
  const first = host.getByRole("tab", { name: "第一个标签", exact: true });
  const second = host.getByRole("tab", { name: "第二个标签", exact: true });
  const firstPanel = host.getByRole("tabpanel", { name: "第一个标签", exact: true });
  const firstNode = await firstPanel.elementHandle();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(second).toHaveCSS("outline-style", "solid");
  await expect(firstPanel).toBeHidden();
  await expect(page).toHaveURL(/#doc-tabs-1-panel-1$/);
  await capture(page, theme, width, "selected");
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  expect(await firstPanel.evaluate((element, previous) => element === previous, firstNode)).toBe(true);
  await page.evaluate(() => { window.location.hash = "heading-1-1-0"; });
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(host.getByText("第二段内容", { exact: true })).toBeVisible();
  const copy = host.getByRole("button", { name: "复制代码", exact: true });
  await copy.click();
  await expect(copy).toHaveText("已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const count = 1; // 保留代码注释\nconsole.log("hello");');
  await capture(page, theme, width, "copied");
  expect(await host.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
