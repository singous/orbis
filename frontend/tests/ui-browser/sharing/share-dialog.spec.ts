import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { id, noteId, notebookId, now, dataPage, mountDocumentSurface, captureDialogEvidence, installDocumentSurfaceSession } from "../fixtures/document-surfaces";

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test.describe(`${theme} ${width}px`, () => {
  test.use({ hasTouch: width === 390 });
  test.beforeEach(async ({ page }) => { await installDocumentSurfaceSession(page, theme, width); });

  test("share dialog copies URLs and keeps pending creation open", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const share = { id: id(8), collection_id: notebookId, root_document_id: noteId, version: 2, created_at_ms: now, revoked_at_ms: null, expires_at_ms: null, path: "/share/test-link" };
    const writes: { method: string; body: unknown }[] = [];
    await page.route("**/api/v1/**", async route => {
      let data: unknown = dataPage([]);
      if (new URL(route.request().url()).pathname.endsWith("/shares")) {
        if (route.request().method() === "POST") { writes.push({ method: "POST", body: route.request().postDataJSON() }); await pending; data = { share, path: share.path, token: "test-link" }; }
        else data = dataPage([share]);
      }
      await route.fulfill({ json: { code: "OK", message: "", request_id: "sharing-ui", data } });
    });
    await mountDocumentSurface(page, "sharing");
    await page.getByRole("button", { name: "分享", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "分享在线文档" });
    await expect(dialog.getByRole("button", { name: "复制链接（已有分享）" })).toBeVisible();
    expect((await dialog.boundingBox())?.width).toBe(width === 390 ? 358 : 448);
    await expect(dialog).toHaveCSS("opacity", "1");
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    const disclosureContrast = await dialog.locator('[data-ui="share-management"] > div').first().evaluate(element => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
      };
      const background = luminance(getComputedStyle(element).backgroundColor);
      return [element, element.querySelector("p")!].map(node => {
        const foreground = luminance(getComputedStyle(node).color);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
    });
    expect(Math.min(...disclosureContrast)).toBeGreaterThanOrEqual(4.5);
    await captureDialogEvidence(page, "sharing", theme, width);
    await dialog.getByRole("button", { name: "复制链接（已有分享）" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("http://127.0.0.1:" + (process.env.ORBIS_UI_WEB_PORT || "9320") + "/share/test-link");
    await dialog.getByRole("button", { name: "创建公开链接" }).click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(dialog.getByRole("button", { name: "创建公开链接", exact: true })).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-ending-style");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).not.toHaveAttribute("data-ending-style");
    await page.mouse.click(0, 0);
    await expect(dialog).not.toHaveAttribute("data-ending-style");
    release();
    await expect(dialog.getByRole("textbox", { name: "公开链接", exact: true })).toHaveValue(/\/share\/test-link$/);
    expect(writes).toEqual([{ method: "POST", body: { collection_id: notebookId, root_document_id: noteId, acknowledge_public_scope: true } }]);
    await expect(dialog).not.toHaveAttribute("data-ending-style");
    await expect(dialog).toHaveCSS("opacity", "1");
    await captureDialogEvidence(page, "sharing-created", theme, width);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    const lastAction = dialog.getByRole("button").last();
    await lastAction.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(lastAction).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "分享", exact: true })).toBeFocused();
  });
});
