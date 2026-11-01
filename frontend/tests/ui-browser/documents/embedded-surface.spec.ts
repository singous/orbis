import { expect, test } from "@playwright/test";
import { appendFileSync } from "node:fs";

test("expanded content keeps its nested theme, live tokens and editor identity", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orbis.appearance", "dark"));
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto("/login");
  await page.evaluate(async () => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const surfaceURL = "/src/shared/ui/EmbeddedSurface.tsx";
    const [{ default: React }, { default: ReactDOM }, { EmbeddedSurface }] = await Promise.all([import(reactURL), import(domURL), import(surfaceURL)]);
    const oldRoot = document.getElementById("root")!;
    oldRoot.hidden = true;
    oldRoot.id = "application-preview-root";
    const host = document.createElement("div");
    host.id = "root";
    host.dataset.testid = "nested-theme-source";
    host.dataset.theme = "light";
    host.className = "bg-ob-card p-5 text-ob-foreground";
    host.style.setProperty("--ob-surface", "#abcdef");
    host.style.setProperty("--ob-foreground", "#123456");
    document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(EmbeddedSurface, { label: "嵌套主题内容", kind: "table", surfaceKey: "nested-theme" }, React.createElement("input", { "aria-label": "嵌套草稿", defaultValue: "初稿" })));
  });
  const region = page.getByRole("region", { name: "嵌套主题内容", exact: true });
  const draft = region.getByRole("textbox", { name: "嵌套草稿" });
  await expect(region).toHaveCSS("background-color", "rgb(171, 205, 239)");
  await expect(region).toHaveCSS("color", "rgb(18, 52, 86)");
  await draft.fill("跨主题展开保留草稿");
  const original = await draft.elementHandle();
  await region.getByRole("button", { name: "全屏展开" }).click();
  await expect(region).toHaveCSS("background-color", "rgb(171, 205, 239)");
  await expect(region).toHaveCSS("color", "rgb(18, 52, 86)");
  const origin = page.getByTestId("nested-theme-source");
  await origin.evaluate(element => {
    element.style.setProperty("--ob-surface", "#fedcba");
    element.style.setProperty("--ob-foreground", "#654321");
  });
  await expect(region).toHaveCSS("background-color", "rgb(254, 220, 186)");
  await expect(region).toHaveCSS("color", "rgb(101, 67, 33)");
  await origin.evaluate(element => {
    element.dataset.theme = "dark";
    element.style.removeProperty("--ob-surface");
    element.style.removeProperty("--ob-foreground");
  });
  const dark = await origin.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color }));
  await expect(region).toHaveCSS("background-color", dark.background);
  await expect(region).toHaveCSS("color", dark.foreground);
  await region.getByRole("button", { name: "返回文档" }).click();
  expect(await draft.evaluate((element, previous) => element === previous, original)).toBe(true);
  await expect(draft).toHaveValue("跨主题展开保留草稿");
});

for (const theme of ["light", "dark"]) for (const kind of ["board", "table"] as const) for (const context of ["standalone", "workspace"]) {
  test(`embedded ${kind} retains layout and editor identity in ${theme} ${context}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.goto("/login");
    await page.evaluate(async ({ kind, context }) => {
      const source = await (await fetch("/src/main.tsx")).text();
      const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
      const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
      const surfaceURL = "/src/shared/ui/EmbeddedSurface.tsx";
      const [{ default: React }, { default: ReactDOM }, { EmbeddedSurface }] = await Promise.all([import(reactURL), import(domURL), import(surfaceURL)]);
      const previous = document.getElementById("root")!;
      previous.hidden = true;
      previous.id = "application-preview-root";
      const host = document.createElement("div");
      host.id = "root";
      host.style.padding = "20px";
      if (context === "workspace") {
        const workspaceURL = "/src/features/workspace/workspace-chrome.ts";
        host.className = (await import(workspaceURL)).workspaceShellClassName;
      }
      document.body.append(host);
      function Editor() {
        return React.createElement("div", { "data-testid": "embedded-scroll", style: { height: "100%", overflow: "auto" } },
          React.createElement("input", { "aria-label": "嵌入草稿", defaultValue: "初稿" }),
          React.createElement("button", { type: "button", onKeyDown: (event: KeyboardEvent) => { if (event.key === "Escape") event.preventDefault(); } }, "内部处理 Escape"),
          React.createElement("div", { style: { height: 1200 } }, "编辑内容"));
      }
      ReactDOM.createRoot(host).render(React.createElement(EmbeddedSurface, { label: "完整嵌入内容标题", kind, surfaceKey: "browser-identity", defaultHeight: 300 }, React.createElement(Editor)));
    }, { kind, context });
    const region = page.getByRole("region", { name: "完整嵌入内容标题" });
    const input = page.getByRole("textbox", { name: "嵌入草稿" });
    await expect(input).toBeVisible();
    await input.fill("尚未提交的草稿");
    const originalInput = await input.elementHandle();
    for (const width of [1280, 641, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(region).toHaveCSS("height", "300px");
      await expect(region).toHaveCSS("border-radius", "6px");
      await expect(region.locator(".embed-heading")).toHaveCSS("gap", width <= 640 ? "6px" : "12px");
      await expect(region.locator(".embed-heading")).toHaveCSS("padding-left", kind === "table" ? "0px" : width <= 640 ? "6px" : "10px");
      await expect(region.locator(".embed-label")).toBeVisible({ visible: kind === "board" });
      expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (process.env.ORBIS_EMBEDDED_EVIDENCE) {
        const values = await region.evaluate(element => [element, ...element.querySelectorAll("header,.embed-label,.embed-actions,button,.embed-content,.embed-resize-bar,.embed-resize-handle,.embed-resize-handle>span")].map(node => {
          const css = getComputedStyle(node), box = node.getBoundingClientRect();
          return { node: node.tagName, className: node.className.split(" ")[0], x: box.x, y: box.y, width: box.width, height: box.height, display: css.display, gap: css.gap, padding: css.padding, fontSize: css.fontSize, color: css.color, background: css.backgroundColor, border: css.border, position: css.position };
        }));
        appendFileSync(process.env.ORBIS_EMBEDDED_EVIDENCE, JSON.stringify({ theme, kind, context, width, values }) + "\n");
      }
    }
    const scroll = page.getByTestId("embedded-scroll");
    await scroll.evaluate(element => { element.scrollTop = 150; });
    await region.getByRole("button", { name: "全屏展开" }).click();
    await expect(region.getByRole("button", { name: "返回文档" })).toBeFocused();
    await expect(region).toHaveCSS("height", "900px");
    await expect(region).toHaveCSS("border-radius", "0px");
    await expect(region.locator(".embed-heading")).toHaveCSS("min-height", "48px");
    expect(await page.locator("#root").evaluate(element => element.inert)).toBe(true);
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    expect(await input.evaluate((element, original) => element === original, originalInput)).toBe(true);
    await expect(input).toHaveValue("尚未提交的草稿");
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(150);
    await input.focus();
    await page.keyboard.press("Escape");
    await expect(region.getByRole("button", { name: "返回文档" })).toBeVisible();
    await region.getByRole("button", { name: "内部处理 Escape" }).click();
    await page.keyboard.press("Escape");
    await expect(region.getByRole("button", { name: "返回文档" })).toBeVisible();
    await scroll.evaluate(element => { element.scrollTop = 150; });
    await region.getByRole("button", { name: "返回文档" }).click();
    await expect(region.getByRole("button", { name: "全屏展开" })).toBeFocused();
    expect(await page.locator("#root").evaluate(element => element.inert)).toBe(false);
    expect(await input.evaluate((element, original) => element === original, originalInput)).toBe(true);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(150);
    const handle = region.getByRole("separator", { name: "调整嵌入高度" });
    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await expect(handle).toHaveAttribute("aria-valuenow", "340");
    await expect(handle).toHaveCSS("outline-style", "solid");
    const saved = await page.evaluate(() => sessionStorage.getItem("orbis.embed-height:browser-identity"));
    expect(saved).toBe(kind === "table" ? "340" : null);
    await region.getByRole("button", { name: "恢复默认高度" }).click();
    await expect(handle).toHaveAttribute("aria-valuenow", "300");
  });
}
