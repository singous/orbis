import { expect, test } from "@playwright/test";
import { expectTokenStyles } from "../helpers/theme-probes";
import { expectVisibleKeyboardFocus } from "../../ui-browser/fixtures/media";

test("native fields and actions follow live light and dark themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const email = page.getByLabel("邮箱", { exact: true });
  const submit = page.getByRole("button", { name: "登录 Orbis", exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, mode);
    await email.focus();
    await expectTokenStyles(page.locator("body"), { "background-color": "--background", color: "--foreground" });
    await expectTokenStyles(email, { color: "--foreground", "border-color": "--ring", "outline-color": "--ring" });
    await expectVisibleKeyboardFocus(email);
    await expectTokenStyles(submit, { "background-color": "--primary", color: "--primary-foreground" });
    await expect(email).toHaveAttribute("data-slot", "input");
    await expect(submit).toHaveAttribute("data-slot", "button");
    const rendered = await email.evaluate(async element => {
      await document.fonts.ready;
      return { height: element.getBoundingClientRect().height, font: getComputedStyle(element).fontFamily,
        loaded: Array.from(document.fonts).some(font => font.family.includes("Geist Variable") && font.status === "loaded") };
    });
    expect(rendered.height).toBeGreaterThanOrEqual(24);
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    expect(rendered.font).toContain("Geist Variable");
    expect(rendered.loaded).toBe(true);
  }
});


test("workbench native actions and dialogs follow shared theme tokens", async ({ page, request }) => {
  // Desktop retains the global header search; web uses the rail entry.
  await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "主题验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const createNotebook = page.locator(".notebook-overview .page-actions").getByRole("button", { name: "新建笔记本", exact: true });
  await expect(createNotebook).toBeVisible();
  await expect(createNotebook).toHaveAttribute("data-slot", "button");
  await expectTokenStyles(createNotebook, { "border-radius": "--radius" });
  const originalRadius = await createNotebook.evaluate(element => getComputedStyle(element).borderRadius);
  await page.evaluate(() => document.documentElement.style.setProperty("--radius", "1.25rem"));
  await expectTokenStyles(createNotebook, { "border-radius": "--radius" });
  expect(await createNotebook.evaluate(element => getComputedStyle(element).borderRadius)).not.toBe(originalRadius);
  await page.evaluate(() => document.documentElement.style.removeProperty("--radius"));
  await expect(page.getByRole("button", { name: "全局搜索", exact: true })).toHaveAttribute("data-slot", "button");
  await page.goto("/sites");
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建文档站点", exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, mode);
    const cancel = dialog.getByRole("button", { name: "取消", exact: true });
    await expect(cancel).toHaveAttribute("data-slot", "button");
    await expectTokenStyles(dialog, { "background-color": "--popover", color: "--popover-foreground" });
    const radio = dialog.getByRole("radiogroup", { name: "内容来源方式", exact: true }).getByRole("radio", { name: "关联笔记本", exact: true });
    await expect(radio).toBeVisible();
    await expect(radio).toHaveAttribute("data-slot", "radio-group-item");
    await expect(dialog.getByRole("radio", { name: "手动选择", exact: true })).toBeChecked();
    const create = dialog.getByRole("button", { name: "创建站点", exact: true });
    await expectTokenStyles(create, { "background-color": "--primary", color: "--primary-foreground" });
  }
});
