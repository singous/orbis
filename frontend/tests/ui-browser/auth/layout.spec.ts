import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";

for (const route of ["login", "setup"]) {
  test(`auth ${route} keeps capsule controls and layout across existing breakpoints`, async ({ page }) => {
    await page.goto(`/${route}`);
    for (const width of [1280, 1000, 900, 755, 480, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const email = page.getByLabel("邮箱", { exact: true });
      const password = page.getByLabel("密码", { exact: true });
      const submit = page.getByRole("button", { name: route === "login" ? "登录 Orbis" : "创建并进入工作空间" });
      const geometry = await email.evaluate(element => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { height: box.height, width: box.width, radius: parseFloat(style.borderRadius), textInset: parseFloat(style.paddingInlineStart) };
      });
      expect(geometry.height).toBe(52);
      expect(geometry.radius).toBeGreaterThanOrEqual(geometry.height / 2);
      expect(geometry.textInset).toBe(50);
      expect((await password.boundingBox())!.height).toBe(52);
      expect((await submit.boundingBox())!.height).toBe(52);
      expect((await submit.boundingBox())!.width).toBeCloseTo(geometry.width, 1);
      if (width > 900) await expect(page.getByRole("complementary", { name: "关于 Orbis" })).toBeVisible();
      else await expect(page.getByRole("complementary", { name: "关于 Orbis" })).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const before = await email.boundingBox();
      await email.focus();
      expect(await email.boundingBox()).toEqual(before);
      expect(await email.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    }
    await page.getByRole("link", { name: "Orbis", exact: true }).focus();
    await page.keyboard.press("Tab");
    if (route === "setup") {
      await expect(page.getByLabel("显示名称", { exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
    }
    await expect(page.getByLabel("邮箱", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("密码", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: route === "login" ? "登录 Orbis" : "创建并进入工作空间" })).toBeFocused();
  });
}

test("auth illustration pause and accessibility modes keep their controls usable", async ({ page }) => {
  await page.goto("/login");
  const artwork = page.locator("[data-motion-paused] img");
  await expect(artwork).toBeVisible();
  await page.getByRole("button", { name: "暂停动画（插画）" }).click();
  await expect(page.getByRole("button", { name: "播放动画（插画）" })).toBeFocused();
  expect(await artwork.evaluate(element => getComputedStyle(element).animationPlayState)).toBe("paused");
  await page.getByRole("button", { name: "播放动画（插画）" }).click();
  expect(await artwork.evaluate(element => getComputedStyle(element).animationPlayState)).toBe("running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "暂停动画（插画）" })).toBeHidden();
  expect(await artwork.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.getByRole("complementary", { name: "关于 Orbis" })).toBeHidden();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
  expect(await page.getByLabel("邮箱", { exact: true }).evaluate(element => getComputedStyle(element).borderTopStyle)).toBe("solid");
});

for (const { theme, width } of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) {
  for (const route of ["login", "setup"] as const) test(`media acceptance: ${route} ${theme} ${width} keeps keyboard fields without submitting`, async ({ page }, info) => {
    const writes: string[] = [];
    const evidence: Record<string, unknown> = { route: `/${route}`, theme, width, forcedColors: "active", reducedMotion: "reduce", writes };
    page.on("request", request => { if (request.url().includes("/api/v1/") && request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    try {
      await page.goto(`/${route}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("link", { name: "Orbis", exact: true }).focus();
      const fields = route === "setup" ? ["显示名称", "邮箱", "密码"] : ["邮箱", "密码"];
      for (const label of fields) {
        await page.keyboard.press("Tab");
        const field = page.getByLabel(label, { exact: true });
        evidence[label] = await expectVisibleKeyboardFocus(field);
        await page.keyboard.type(label === "显示名称" ? "媒体验收成员" : label === "邮箱" ? "media@example.com" : "media-password-2026");
        await expect(field).not.toHaveValue("");
      }
      await page.keyboard.press("Tab");
      const submit = page.getByRole("button", { name: route === "login" ? "登录 Orbis" : "创建并进入工作空间", exact: true });
      evidence.submitFocus = await expectVisibleKeyboardFocus(submit);
      await expect(submit).toBeEnabled();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByLabel("密码", { exact: true })).toBeFocused();
      await expect(page.getByRole("complementary", { name: "关于 Orbis" })).toBeHidden();
      evidence.motion = await expectNoContinuingMotion(page.getByRole("main"));
      const illustration = await page.locator("[data-motion-paused] img").evaluateAll(elements => elements.map(element => ({ animation: getComputedStyle(element).animationName, visible: element.getClientRects().length > 0 })));
      evidence.illustration = illustration;
      expect(illustration.every(item => item.animation === "none")).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      evidence.axe = accessibility.violations;
      expect(accessibility.violations).toEqual([]);
      expect(writes).toEqual([]);
    } finally {
      await info.attach("auth-media-acceptance", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    }
  });
}
