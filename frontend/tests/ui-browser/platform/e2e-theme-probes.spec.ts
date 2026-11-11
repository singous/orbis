import { expect, test } from "@playwright/test";
import { expectTokenStyles } from "../../e2e/helpers/theme-probes";
import { installSession, pagination, user } from "../fixtures/session";
import { dataPage, id, installDocumentSurfaceSession, mountDocumentSurface, nativeContent, version } from "../fixtures/document-surfaces";
import { expectVisibleKeyboardFocus } from "../fixtures/media";

test("theme probes reject missing or invalid roles on an actual field", async ({ page }) => {
  await page.goto("/login");
  const email = page.getByLabel("邮箱", { exact: true });
  await expect(expectTokenStyles(email, { "background-color": "--missing-test-role" })).rejects.toThrow("must exist");
  await email.evaluate(element => element.style.setProperty("--invalid-test-role", "invalid-color"));
  await expect(expectTokenStyles(email, { "background-color": "--invalid-test-role" })).rejects.toThrow("must be valid");
});

test("version comparison exposes its labelled combobox on the real history panel", async ({ page }) => {
  await installDocumentSurfaceSession(page, "light", 1280);
  const revised = { ...version, id: id(10), name: "修订稿" };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/versions") ? { items: [version, revised], pagination: { next_cursor: null, has_more: false }, automatic_history_enabled: true }
      : path.endsWith("/content") ? { version: revised, content: nativeContent, dependencies: [] }
      : path.endsWith("/compare") ? { from: version, to: revised, items: [], pagination: { next_cursor: null, has_more: false } } : dataPage([]);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "e2e-version-locator", data } });
  });
  await mountDocumentSurface(page, "collaboration");
  await page.getByRole("button", { name: "打开评论与历史", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "评论与历史", exact: true });
  await panel.getByRole("tab", { name: "历史版本", exact: true }).click();
  await panel.getByRole("button", { name: "查看版本 修订稿", exact: true }).click();
  await panel.getByRole("combobox", { name: "选择比较起点", exact: true }).click();
  await page.getByRole("option", { name: /评审稿/ }).click();
  await expect(panel.getByRole("heading", { name: "内容差异", exact: true })).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} workbench locators reach styled actions, radios and comboboxes`, async ({ page }) => {
    await installSession(page);
    await page.addInitScript(theme => {
      localStorage.setItem("orbis.appearance", theme);
      Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } });
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/v1/**", route => route.fulfill({ json: { code: "OK", message: "", request_id: "e2e-theme-probes", data: new URL(route.request().url()).pathname === "/api/v1/me" ? user : { items: [], pagination } } }));
    await page.goto("/documents");
    const create = page.locator(".notebook-overview .page-actions").getByRole("button", { name: "新建笔记本", exact: true });
    await expectTokenStyles(create, { "border-radius": "--radius-lg" });
    await page.locator("html").evaluate(element => element.style.setProperty("--radius", ".5rem"));
    await expectTokenStyles(create, { "border-radius": "--radius-lg" });
    await page.locator("html").evaluate(element => element.style.removeProperty("--radius"));
    await expect(page.getByRole("button", { name: "搜索文档", exact: true })).toBeEnabled();
    await create.click();
    const notebook = page.getByRole("dialog", { name: "新建笔记本", exact: true });
    for (const name of ["预设图标", "图标颜色"]) {
      const radios = notebook.getByRole("radiogroup", { name, exact: true }).getByRole("radio");
      await radios.first().focus();
      await page.keyboard.press("ArrowRight");
      await expect(radios.nth(1)).toBeFocused();
      await expect(radios.nth(1)).toBeChecked();
      await expectVisibleKeyboardFocus(radios.nth(1));
    }
    await page.keyboard.press("Escape");
    await page.goto("/sites");
    await page.getByRole("button", { name: "创建站点", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建文档站点", exact: true });
    await expectTokenStyles(dialog, { "border-radius": "--radius-xl", "background-color": "--popover", color: "--popover-foreground" });
    await expectTokenStyles(dialog.getByRole("button", { name: "取消", exact: true }), { "border-radius": "--radius-lg" });
    const radio = dialog.getByRole("radiogroup", { name: "内容来源方式", exact: true }).getByRole("radio", { name: "关联笔记本", exact: true });
    await expect(radio).toHaveAttribute("data-slot", "radio-group-item");
    await radio.click();
    await expect(radio).toBeChecked();
    const trigger = dialog.getByRole("combobox", { name: "站点场景", exact: true });
    await trigger.click();
    const option = page.getByRole("listbox").getByRole("option").last();
    const label = await option.innerText();
    await option.click();
    await expect(trigger).toContainText(label.trim());
    await expect(dialog).toBeVisible();
  });

  test(`${theme} sheet field probes read the actual hover, focus and radius owners`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/__ui");
    await page.evaluate(async () => {
      const source = await (await fetch("/src/main.tsx")).text();
      const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
      const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
      const componentURL = "/src/features/sheets/FieldSettings.tsx";
      const [{ default: React }, { default: ReactDOM }, { FieldSettings }] = await Promise.all([import(reactURL), import(domURL), import(componentURL)]);
      document.getElementById("root")!.hidden = true;
      const host = document.createElement("div");
      document.body.append(host);
      const root = ReactDOM.createRoot(host);
      root.render(React.createElement(FieldSettings, { field: { id: "name", name: "名称", kind: "text", options: [], default: null }, anchor: { left: 20, top: 20 }, onSave: async () => {}, onClose: () => root.unmount() }));
    });
    const dialog = page.getByRole("dialog", { name: "字段设置", exact: true });
    const submit = dialog.getByRole("button", { name: "保存字段", exact: true });
    const field = dialog.getByRole("textbox", { name: "字段名称", exact: true });
    await page.mouse.move(0, 0);
    await expectTokenStyles(submit, { "background-color": "--primary", color: "--primary-foreground" });
    await submit.focus();
    await expectTokenStyles(field, { "background-color": "--muted", "border-radius": "--radius-sm", "font-family": "--font-sans" });
    const background = await field.evaluate(element => getComputedStyle(element).backgroundColor);
    await field.hover();
    await expect(field).toHaveCSS("background-color", background);
    await field.focus();
    await expect(field).toHaveCSS("background-color", background);
    await expectTokenStyles(field, { "border-color": "--ring" });
    await expectVisibleKeyboardFocus(field);

    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
