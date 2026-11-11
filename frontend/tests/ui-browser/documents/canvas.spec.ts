import { expect, test } from "@playwright/test";
import { documentEditorHTTP, documentId } from "../fixtures/document-editor";
import { installSession } from "../fixtures/session";

test("document header shows the real offline state and toggles the outline", async ({ page, context }) => {
  await installSession(page);
  const writes = await documentEditorHTTP(page);
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole("textbox", { name: "文档标题" })).toHaveValue("界面平台化设计");
  await expect(page.getByRole("toolbar", { name: "文档格式" })).toBeVisible();

  const outline = page.getByRole("complementary", { name: "文档大纲", exact: true });
  const toggle = page.getByRole("button", { name: "文档大纲", exact: true });
  await expect(outline.getByRole("button", { name: "协作与知识组织", exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(outline).toBeHidden();
  await toggle.press("Space");
  await expect(outline).toBeVisible();

  const save = page.locator(".document-save-state");
  await expect(save).toHaveText("已保存");
  try {
    await context.setOffline(true);
    await expect(save).toHaveText("已离线");
  } finally {
    await context.setOffline(false);
  }
  await expect(save).toHaveText("已保存");
  expect(writes).toEqual([]);
});

for (const touch of [false, true]) test.describe(touch ? "touch document canvas" : "desktop document canvas", () => {
  test.use({ hasTouch: touch });
  for (const theme of ["light", "dark"]) test(`keeps title and content gutters in ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
    await page.goto("/__ui");
    await page.evaluate(async () => {
      const source = await (await fetch("/src/main.tsx")).text();
      const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
      const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
      const inputURL = "/packages/ui/src/input/index.tsx";
      const chromeURL = "/src/features/documents/editor/document-chrome.ts";
      const [{ default: React }, { default: ReactDOM }, { Input }, chrome] = await Promise.all([import(reactURL), import(domURL), import(inputURL), import(chromeURL)]);
      const host = document.createElement("div");
      host.dataset.testid = "document-canvas-preview";
      host.className = "grid w-full justify-items-center";
      document.body.append(host);
      ReactDOM.createRoot(host).render(React.createElement("article", { className: chrome.editorCanvasClassName },
        React.createElement("button", { type: "button" }, "标题前的操作"),
        React.createElement(Input, { "aria-label": "布局文档标题", placeholder: "无标题", defaultValue: "文档标题", className: chrome.editorTitleClassName }),
        React.createElement("div", { "data-testid": "document-body-preview" }, "正文起点"),
      ));
    });
    const host = page.getByTestId("document-canvas-preview");
    const title = host.getByRole("textbox", { name: "布局文档标题", exact: true });
    await expect(title).toBeVisible();
    for (const width of [1280, 900, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(title).toHaveAttribute("data-slot", "input");
      await expect(title).toBeEditable();
      const inset = await title.evaluate(element => getComputedStyle(element).paddingLeft);
      expect(parseFloat(inset)).toBeGreaterThan(0);
      await expect(host.getByTestId("document-body-preview")).toHaveCSS("margin-left", inset);
      await expect(host.locator("article")).toHaveCSS("padding-bottom", width <= 640 ? "52px" : width <= 1023 ? "64px" : "0px");
      expect(await host.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await host.getByRole("button", { name: "标题前的操作", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(title).toBeFocused();
    expect(await title.evaluate(element => getComputedStyle(element).boxShadow !== "none" || getComputedStyle(element).outlineStyle !== "none")).toBe(true);
    await host.getByTestId("document-body-preview").evaluate(element => element.classList.add("orbis-tiptap"));
    const contentCSS = "/src/features/documents/editor/blocks/block-selection.css";
    await page.evaluate(url => import(url), contentCSS);
    const contentGutter = await title.evaluate(element => getComputedStyle(element).paddingLeft);
    await expect(host.getByTestId("document-body-preview")).toHaveCSS("margin-left", contentGutter);
    await title.fill("原生标题输入");
    await expect(title).toHaveValue("原生标题输入");
  });
});
