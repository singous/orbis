import { expect, test } from "@playwright/test";
import { expectVisibleKeyboardFocus } from "../fixtures/media";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orbis.appearance", "light"));
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toBeVisible();
});

test("input surfaces follow the nearest data/class theme, including the theme root itself", async ({ page }) => {
  const results = await page.evaluate(() => {
    const template = document.querySelector<HTMLInputElement>('[data-slot="input"]')!;
    const host = document.createElement("div");
    const dark = document.createElement("div"); dark.dataset.theme = "dark";
    const light = document.createElement("div"); light.dataset.theme = "light";
    const again = document.createElement("div"); again.className = "dark";
    host.append(dark); dark.append(light); light.append(again);
    const placements: [string, HTMLElement][] = [["dark", dark], ["light", light], ["darkAgain", again]];
    const inputs = placements.map(([name, parent]) => { const input = template.cloneNode() as HTMLInputElement; input.removeAttribute("id"); parent.append(input); return { name, input }; });
    const self = template.cloneNode() as HTMLInputElement; self.removeAttribute("id"); self.dataset.theme = "dark"; host.append(self); inputs.push({ name: "self", input: self });
    document.body.append(host);
    const values = inputs.map(({ name, input }) => {
      const actual = getComputedStyle(input).backgroundColor;
      const expected = document.createElement("span");
      expected.style.backgroundColor = "var(--muted)";
      input.parentElement!.append(expected);
      if (name === "self") expected.dataset.theme = "dark";
      const color = getComputedStyle(expected).backgroundColor;
      expected.remove();
      return { name, actual, expected: color };
    });
    host.remove();
    return values;
  });
  for (const item of results) expect(item.actual, item.name).toBe(item.expected);
  expect(results.find(item => item.name === "dark")?.actual).not.toBe(results.find(item => item.name === "light")?.actual);
});

test("hovering a child does not apply dark utility styles to an unstyled theme container", async ({ page }) => {
  await page.evaluate(() => {
    const host = document.createElement("div"); host.dataset.theme = "dark"; host.dataset.testid = "hover-theme-scope";
    host.style.cssText = "position:fixed;top:20px;left:20px;z-index:100;padding:20px";
    const button = document.querySelector<HTMLButtonElement>('button[type="submit"]')!.cloneNode(true) as HTMLButtonElement;
    button.removeAttribute("id"); button.textContent = "主题子按钮"; host.append(button); document.body.append(host);
  });
  const host = page.getByTestId("hover-theme-scope");
  const before = await host.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  await host.getByRole("button", { name: "主题子按钮" }).hover();
  expect(await host.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))).toEqual(before);
});

test("native default borders retain their theme role after Tailwind preflight", async ({ page }) => {
  const borders = await page.evaluate(() => ["light", "dark"].map(theme => {
    const host = document.createElement("div");
    host.dataset.theme = theme;
    const actual = document.createElement("div"); actual.className = "border";
    const expected = document.createElement("div"); expected.style.borderColor = "var(--border)";
    host.append(actual, expected); document.body.append(host);
    const result = { theme, actual: getComputedStyle(actual).borderTopColor, expected: getComputedStyle(expected).borderTopColor, width: getComputedStyle(actual).borderTopWidth };
    host.remove();
    return result;
  }));
  for (const border of borders) {
    expect(border.actual, border.theme).toBe(border.expected);
    expect(border.width).toBe("1px");
  }
});

test("explicit component focus utilities override the shared accessible fallback", async ({ page }) => {
  const logo = page.getByRole("link", { name: "Orbis", exact: true });
  await logo.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(logo).toBeFocused();
  await expect(logo).toHaveCSS("outline-offset", "4px");
  await expect(logo).toHaveCSS("outline-style", "solid");
});

test("native focus remains the default and forced colors supplies a visible system outline", async ({ page }) => {
  await page.getByRole("link", { name: "Orbis", exact: true }).focus();
  await page.keyboard.press("Tab");
  const input = page.getByRole("textbox", { name: "邮箱", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "none");
  await expectVisibleKeyboardFocus(input);
  await page.emulateMedia({ forcedColors: "active" });
  await expect(input).toHaveCSS("outline-style", "solid");
  await expectVisibleKeyboardFocus(input);
});
