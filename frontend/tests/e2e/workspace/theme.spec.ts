import { expect, test } from "@playwright/test";

test("the supplied theme reaches rendered fields in both color schemes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const email = page.getByLabel("邮箱", { exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, mode);
    await email.focus();
    await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(mode === "light" ? "oklch(0.9702 0 0)" : "oklch(0.12 0 0)");
    const rendered = await email.evaluate(async (element) => {
      await document.fonts.ready;
      const field = getComputedStyle(element);
      // Compare resolved colors; production CSS may serialize tokens differently.
      const probe = document.createElement("span");
      probe.style.color = field.getPropertyValue("--focus");
      probe.style.borderColor = field.getPropertyValue("--field-border");
      element.parentElement!.appendChild(probe);
      const focus = getComputedStyle(probe).color;
      const fieldBorder = getComputedStyle(probe).borderColor;
      probe.remove();
      return {
        background: getComputedStyle(document.body).backgroundColor,
        fieldBackground: field.backgroundColor,
        radius: field.borderRadius,
        buttonRadius: getComputedStyle(document.querySelector(".auth-submit")!).borderRadius,
        buttonBackground: getComputedStyle(document.querySelector(".auth-submit")!).backgroundColor,
        buttonForeground: getComputedStyle(document.querySelector(".auth-submit")!).color,
        focus,
        fieldBorder,
        outline: field.outlineStyle,
        font: field.fontFamily,
        loadedInter: Array.from(document.fonts).some((font) => font.family.includes("Inter Variable") && font.status === "loaded"),
      };
    });
    expect(rendered.background).toBe(mode === "light" ? "oklch(0.9702 0 0)" : "oklch(0.12 0 0)");
    expect(rendered.fieldBackground).toBe(mode === "light" ? "oklch(1 0 0)" : "oklch(0.2103 0 0)");
    expect(rendered.radius).toBe("8px");
    expect(rendered.buttonRadius).toBe("12px");
    expect(rendered.buttonBackground).toBe(mode === "light" ? "oklch(0 0 0)" : "oklch(0.9848 0 0)");
    expect(rendered.buttonForeground).toBe(mode === "light" ? "oklch(0.9911 0 0)" : "oklch(0.15 0 0)");
    expect(rendered.focus).toBe(mode === "light" ? "oklch(0 0 0)" : "oklch(0.9848 0 0)");
    expect(rendered.fieldBorder).toBe("rgba(0, 0, 0, 0)");
    expect(rendered.outline).toBe("none");
    expect(rendered.font).toContain("Inter Variable");
    expect(rendered.loadedInter).toBe(true);
  }
});


test("workbench action and field shapes follow HeroUI theme calculations", async ({ page, request }) => {
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
  await page.evaluate(() => document.documentElement.style.setProperty("--radius", "0.5rem"));
  expect(await createNotebook.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("24px");
  await page.evaluate(() => document.documentElement.style.removeProperty("--radius"));
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
    const radio = dialog.locator('[data-slot="radio-control"]').first();
    await expect(radio).toBeVisible();
    expect(await radio.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("4px");
    const create = dialog.getByRole("button", { name: "创建站点", exact: true });
    expect(await create.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("12px");
  }
});
