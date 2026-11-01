import { expect, test } from "@playwright/test";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";
import { readContrasts } from "../fixtures/contrast";

test("focus contrast probe composites translucent paint and rejects an invisible outline", async ({ page }, info) => {
  await page.goto("/__ui");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:10px;top:10px;z-index:2147483647;background:white;padding:20px";
    const button = document.createElement("button");
    button.dataset.testid = "contrast-probe";
    button.textContent = "焦点对比探针";
    button.style.cssText = "background:white;color:black;outline:2px solid rgba(0,0,0,.01);outline-offset:2px";
    const panel = document.createElement("div");
    panel.dataset.testid = "translucent-background-probe";
    panel.style.background = "rgba(0,0,0,.8)";
    const text = document.createElement("span");
    text.style.color = "black";
    text.textContent = "叠层对比探针";
    panel.append(text);
    host.append(button, panel);
    document.body.append(host);
  });
  const button = page.getByTestId("contrast-probe");
  await button.focus();
  const [faint] = await readContrasts(button, [null], "outlineColor");
  expect(faint.ratio).toBeLessThan(1.1);
  await expect(expectVisibleKeyboardFocus(button)).rejects.toThrow();
  await button.evaluate(element => { element.style.outlineColor = "black"; element.style.opacity = "0.01"; });
  await expect(expectVisibleKeyboardFocus(button)).rejects.toThrow();
  await button.evaluate(element => { element.style.opacity = "1"; });
  await button.evaluate(element => { element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000, fill: "both" }); });
  await expect(expectVisibleKeyboardFocus(button)).rejects.toThrow();
  await button.evaluate(element => element.getAnimations().forEach(animation => animation.cancel()));
  const opaque = await expectVisibleKeyboardFocus(button);
  expect(opaque.contrast.ratio).toBeCloseTo(21, 3);
  const [layered] = await readContrasts(page.getByTestId("translucent-background-probe"), ["span"]);
  expect(layered.ratio).toBeLessThan(2);
  await info.attach("contrast-probe-results", { body: JSON.stringify({ faint, opaque, layered }), contentType: "application/json" });
});

test("reduced-motion probe accepts the lifecycle transition and rejects continuing web animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/__ui");
  await page.evaluate(async () => {
    await document.fonts.ready;
    const sample = document.createElement("div");
    sample.dataset.testid = "motion-probe";
    sample.textContent = "动画探针";
    document.body.append(sample);
  });
  const sample = page.getByTestId("motion-probe");
  await sample.evaluate(element => { element.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 0.01, iterations: 1 }); });
  await expectNoContinuingMotion(sample);
  for (const timing of [{ duration: 2000, iterations: 1 }, { duration: 10, iterations: Infinity }, { duration: 0.01, delay: 2000, iterations: 1 }]) {
    await sample.evaluate((element, timing) => { element.animate([{ opacity: 1 }, { opacity: 0.5 }], timing); }, timing);
    try {
      await expect(expectNoContinuingMotion(sample)).rejects.toThrow();
    } finally {
      await sample.evaluate(element => element.getAnimations().forEach(animation => animation.cancel()));
    }
  }
});

for (const theme of ["light", "dark"] as const) test(`forced colors preserve ${theme} menu item variants and Select keyboard indicators`, async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/__ui");
  await page.evaluate(async theme => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, menu, { Select }] = await Promise.all([
      import(reactURL), import(domURL), import("/packages/ui/src/dropdown-menu/index.tsx"), import("/packages/ui/src/select/index.tsx"),
    ]);
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.dataset.theme = theme;
    document.body.append(host);
    function Example() {
      const [layout, setLayout] = React.useState("list");
      const [pinned, setPinned] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement(menu.DropdownMenu, null,
          React.createElement(menu.DropdownMenuTrigger, null, "高对比度菜单"),
          React.createElement(menu.DropdownMenuContent, { "aria-label": "高对比度菜单" },
            React.createElement(menu.DropdownMenuItem, null, "普通动作"),
            React.createElement(menu.DropdownMenuItem, { disabled: true }, "不可用动作"),
            React.createElement(menu.DropdownMenuRadioGroup, { value: layout, onValueChange: setLayout },
              React.createElement(menu.DropdownMenuRadioItem, { value: "list" }, "列表"),
              React.createElement(menu.DropdownMenuRadioItem, { value: "grid" }, "网格")),
            React.createElement(menu.DropdownMenuCheckboxItem, { checked: pinned, onCheckedChange: setPinned }, "固定"))),
        React.createElement(Select, { label: "高对比度选择", defaultValue: "a", options: [{ value: "a", label: "选项甲" }, { value: "b", label: "选项乙" }] }));
    }
    ReactDOM.createRoot(host).render(React.createElement(Example));
  }, theme);
  const trigger = page.getByRole("button", { name: "高对比度菜单", exact: true });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "高对比度菜单", exact: true });
  const metrics = [await expectVisibleKeyboardFocus(menu.getByRole("menuitem", { name: "普通动作", exact: true }))];
  await page.keyboard.press("ArrowDown");
  const disabled = menu.getByRole("menuitem", { name: "不可用动作", exact: true });
  await expect(disabled).toBeFocused();
  await expect(disabled).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("ArrowDown");
  metrics.push(await expectVisibleKeyboardFocus(menu.getByRole("menuitemradio", { name: "列表", exact: true })));
  await page.keyboard.press("ArrowDown");
  const grid = menu.getByRole("menuitemradio", { name: "网格", exact: true });
  metrics.push(await expectVisibleKeyboardFocus(grid));
  await page.keyboard.press("Space");
  await expect(grid).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: "列表", exact: true })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("ArrowDown");
  const checkbox = menu.getByRole("menuitemcheckbox", { name: "固定", exact: true });
  metrics.push(await expectVisibleKeyboardFocus(checkbox));
  await page.keyboard.press("Space");
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expectNoContinuingMotion(menu);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  metrics.push(await expectVisibleKeyboardFocus(trigger));
  const select = page.getByRole("combobox", { name: "高对比度选择", exact: true });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  metrics.push(await expectVisibleKeyboardFocus(page.getByRole("option", { name: "选项甲", exact: true })));
  await page.keyboard.press("ArrowDown");
  metrics.push(await expectVisibleKeyboardFocus(page.getByRole("option", { name: "选项乙", exact: true })));
  await page.keyboard.press("Enter");
  await expect(select).toContainText("选项乙");
  metrics.push(await expectVisibleKeyboardFocus(select));
  await info.attach("forced-color-indicators", { body: JSON.stringify({ theme, metrics }), contentType: "application/json" });
});
