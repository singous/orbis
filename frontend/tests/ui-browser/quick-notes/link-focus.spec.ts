import { expect, test, type Locator, type Page } from "@playwright/test";
import { settleNativeEditorSelection } from "../../e2e/helpers/editor-selection";
import { installHomeFixture, now, user, workspace } from "../fixtures/home";

const originalText = "前文 目标 后文";
const note = { id: "00000000-0000-4000-8000-000000000011", workspace_id: workspace.id, owner_id: user.id, version: 4, blocks: [{ id: "00000000-0000-4000-8000-000000000012", type: "paragraph", props: {}, content: [{ text: "旧记录", marks: [], href: null }], children: [] }], tag_ids: [], is_pinned: false, created_at_ms: now, updated_at_ms: now, deleted_at_ms: null };

type Surface = "home" | "regular" | "nested edit";

async function openComposer(page: Page, surface: Surface) {
  await installHomeFixture(page);
  if (surface === "nested edit") {
    await page.route(url => url.pathname.includes("/api/v1/") && url.pathname.endsWith("/quick-notes"), route => route.fulfill({ json: { code: "OK", message: "", request_id: "link-focus", data: { items: [note], pagination: { page: 1, page_size: 20, total: 1 } } } }));
  }
  await page.goto(surface === "home" ? "/home" : "/documents/quick-notes");
  // 首页视觉 fixture 固定了时钟；编辑器选区依赖真实的焦点/点击经过时间。
  await page.evaluate(() => { Date.now = () => new Date().getTime(); });
  if (surface === "nested edit") {
    await page.getByRole("button", { name: "编辑记录", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑随手记", exact: true });
    await expect(dialog).toHaveCSS("opacity", "1");
    return dialog;
  }
  return page.getByRole("region", { name: "快速记录", exact: true });
}

async function selectTarget(page: Page, editor: Locator, apple: boolean) {
  await editor.press(apple ? "Meta+ArrowLeft" : "Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await settleNativeEditorSelection(page, editor);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("目标");
  await expect(editor).toBeFocused();
}

for (const surface of ["home", "regular", "nested edit"] as const) {
  test(`${surface} link dialog restores editor focus and preserves selected text and caret insertion`, async ({ page }) => {
    const composer = await openComposer(page, surface);
    const editor = composer.getByRole("textbox", { name: "随手记正文", exact: true });
    const linkTool = composer.getByRole("button", { name: "插入链接", exact: true });
    const dialog = page.getByRole("dialog", { name: "插入链接", exact: true });
    const input = dialog.getByRole("textbox", { name: "链接地址", exact: true });
    const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    await editor.click();
    await editor.fill(originalText);
    await settleNativeEditorSelection(page, editor);
    await selectTarget(page, editor, apple);

    await linkTool.click();
    await expect(input).toBeFocused();
    await expect(dialog).toHaveCSS("opacity", "1");
    await input.fill("https://example.com/cancelled");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("目标");
    await expect(editor.locator("a")).toHaveCount(0);
    if (surface === "nested edit") await expect(composer).toBeVisible();

    await linkTool.click();
    await expect(input).toBeFocused();
    await expect(dialog).toHaveCSS("opacity", "1");
    await expect(input).toHaveValue("");
    await input.fill("https://example.com/selected");
    await dialog.getByRole("button", { name: "确定", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(editor).toBeFocused();
    await expect(editor.getByRole("link", { name: "目标", exact: true })).toHaveAttribute("href", "https://example.com/selected");
    await expect(editor).toHaveText(originalText);

    await editor.press(apple ? "Meta+ArrowRight" : "End");
    await settleNativeEditorSelection(page, editor);
    await expect.poll(() => editor.evaluate(element => {
      const selection = window.getSelection();
      if (!selection?.focusNode || !element.contains(selection.focusNode)) return null;
      const beforeCaret = document.createRange();
      beforeCaret.selectNodeContents(element);
      beforeCaret.setEnd(selection.focusNode, selection.focusOffset);
      return { collapsed: selection.isCollapsed, before: beforeCaret.toString() };
    })).toEqual({ collapsed: true, before: originalText });
    await expect(editor).toBeFocused();
    await linkTool.click();
    await expect(input).toBeFocused();
    await expect(dialog).toHaveCSS("opacity", "1");
    await input.fill("https://example.com/caret");
    await dialog.getByRole("button", { name: "确定", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(editor).toBeFocused();
    await page.keyboard.type("尾注");
    await expect(editor.getByRole("link", { name: "尾注", exact: true })).toHaveAttribute("href", "https://example.com/caret");
    await expect(editor).toHaveText(`${originalText}尾注`);
    if (surface === "nested edit") await expect(composer).toBeVisible();
  });
}
