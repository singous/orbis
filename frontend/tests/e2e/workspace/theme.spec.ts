import { expect, test } from "@playwright/test";
import { expectTokenStyles } from "../helpers/theme-probes";

test("the supplied theme reaches rendered fields in both color schemes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const email = page.getByLabel("邮箱", { exact: true });
  const submit = page.getByRole("button", { name: "登录 Orbis", exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, mode);
    await email.focus();
    await expect.poll(() => page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).toBe(mode === "light" ? "oklch(0.9702 0 0)" : "oklch(0.12 0 0)");
    await expectTokenStyles(email, {
      color: "--ob-foreground",
      "-webkit-text-fill-color": "--ob-foreground",
      "background-color": "--ob-surface",
      "border-color": "--ob-auth-input-focus-border",
      "outline-color": "--ob-ring",
    });
    await expect(email).toHaveCSS("outline-style", "solid");
    await expect(email).toHaveCSS("outline-width", "2px");
    await expect(email).toHaveCSS("outline-offset", "2px");
    await expectTokenStyles(submit, { "background-color": "--ob-components-button-primary-bg", color: "--ob-components-button-primary-text" });
    const rendered = await email.evaluate(async element => {
      await document.fonts.ready;
      const field = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        radius: parseFloat(field.borderRadius),
        font: field.fontFamily,
        loadedInter: Array.from(document.fonts).some(font => font.family.includes("Inter Variable") && font.status === "loaded"),
      };
    });
    expect(rendered.height).toBe(52);
    expect(rendered.radius).toBeGreaterThanOrEqual(rendered.height / 2);
    const action = await submit.evaluate(element => ({ height: element.getBoundingClientRect().height, radius: parseFloat(getComputedStyle(element).borderRadius) }));
    expect(action.height).toBe(rendered.height);
    expect(action.radius).toBeGreaterThanOrEqual(action.height / 2);
    expect(rendered.font).toContain("Inter Variable");
    expect(rendered.loadedInter).toBe(true);
    await page.getByRole("heading", { name: "欢迎回到 Orbis", exact: true }).click();
    await page.mouse.move(0, 0);
    await expectTokenStyles(email, { "background-color": "--ob-auth-input-background" });
    await expect(email).toHaveCSS("border-color", "rgba(0, 0, 0, 0)");
    await email.hover();
    await expectTokenStyles(email, { "background-color": "--ob-accent-surface" });
  }
});


test("workbench action and field shapes follow Orbis theme calculations", async ({ page, request }) => {
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
  expect(await createNotebook.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("12px");
  // A theme edit must resize the rendered action, not just change a CSS token.
  await page.evaluate(() => document.documentElement.style.setProperty("--ob-radius", "0.5rem"));
  expect(await createNotebook.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("24px");
  await page.evaluate(() => document.documentElement.style.removeProperty("--ob-radius"));
  expect(await page.getByRole("button", { name: "全局搜索", exact: true }).evaluate((element) => getComputedStyle(element).borderRadius)).toBe("8px");
  await page.goto("/sites");
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建文档站点", exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, mode);
    const cancel = dialog.getByRole("button", { name: "取消", exact: true });
    await expect.poll(() => cancel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(mode === "light" ? "oklch(0.94 0 0)" : "oklch(0.274 0 0)");
    expect(await cancel.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("12px");
    expect(await dialog.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("12px");
    const radio = dialog.getByRole("radiogroup", { name: "内容来源方式", exact: true }).getByRole("radio", { name: "关联笔记本", exact: true });
    await expect(radio).toBeVisible();
    await expectTokenStyles(radio, { "border-radius": "--ob-radius-md" });
    const create = dialog.getByRole("button", { name: "创建站点", exact: true });
    expect(await create.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("12px");
  }
});
