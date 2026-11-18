import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { id, commentId, versionId, comment, version, nativeContent, dataPage, mountDocumentSurface, captureDialogEvidence, installDocumentSurfaceSession } from "../fixtures/document-surfaces";

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test.describe(`${theme} ${width}px`, () => {
  test.use({ hasTouch: width === 390 });
  test.beforeEach(async ({ page }) => { await installDocumentSurfaceSession(page, theme, width); });

  test("comments retain reply drafts across tabs and named-version forms", async ({ page }) => {
    const writes: unknown[] = [];
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = dataPage([]);
      if (path.endsWith("/content")) data = { version, content: nativeContent, dependencies: [] };
      else if (path.endsWith("/comments")) {
        if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); data = { ...comment, id: id(7), parent_id: commentId, body: "保留的回复" }; }
        else data = dataPage([comment]);
      } else if (path.endsWith("/versions")) data = { items: [version], pagination: { next_cursor: null, has_more: false }, automatic_history_enabled: true };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "collaboration-ui", data } });
    });
    await mountDocumentSurface(page, "collaboration");
    await page.getByRole("button", { name: "打开评论与历史", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "评论与历史" });
    await expect(panel.getByText("第一条讨论", { exact: false })).toBeVisible();
    await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(Math.min(width * .75, 240));
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(width);
    await captureDialogEvidence(page, "comments", theme, width);
    await panel.getByRole("button", { name: "回复评论" }).click();
    await panel.getByRole("textbox", { name: "回复内容" }).fill("保留的回复");
    await panel.getByRole("tab", { name: "评论", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(panel.getByRole("tab", { name: "历史版本" })).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("button", { name: "查看版本 评审稿" })).toBeVisible();
    await panel.getByRole("button", { name: "新建命名版本" }).click();
    await panel.getByRole("textbox", { name: "新版本名称" }).fill("新评审稿");
    await captureDialogEvidence(page, "versions", theme, width);
    await panel.getByRole("button", { name: "取消新建版本" }).click();
    await panel.getByRole("button", { name: "查看版本 评审稿" }).click();
    await expect(panel.getByText("固定版本正文")).toBeVisible();
    await expect(panel.getByRole("button", { name: "查看版本 评审稿" })).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "编辑名称与说明" }).click();
    await panel.getByRole("textbox", { name: "版本名称", exact: true }).fill("未保存的名称");
    await panel.getByRole("button", { name: "取消", exact: true }).click();
    await expect(panel.getByRole("textbox", { name: "版本名称", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "评审稿", exact: true })).toBeVisible();
    // 取消按钮卸载后，Dialog 会在下一帧再次恢复面板焦点；之后才能把键盘交给 Tab。
    await expect.poll(() => panel.evaluate(element => new Promise<boolean>(resolve => {
      requestAnimationFrame(() => resolve(document.activeElement === element));
    }))).toBe(true);
    const historyTab = panel.getByRole("tab", { name: "历史版本" });
    await historyTab.focus();
    await expect(historyTab).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(panel.getByRole("tab", { name: "评论", exact: true })).toBeFocused();
    await expect(panel.getByRole("tab", { name: "评论", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("textbox", { name: "回复内容" })).toHaveValue("保留的回复");
    await panel.getByRole("button", { name: "发送回复" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([{ body: "保留的回复", parent_id: commentId }]);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "打开评论与历史", exact: true })).toBeFocused();
  });

  test("restoring a fixed version blocks dismissal until its request completes", async ({ page }) => {
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = dataPage([]);
      if (path.endsWith("/restore")) {
        writes.push({ path, body: route.request().postDataJSON() });
        await pending;
        data = { ...nativeContent, revision: { ...nativeContent.revision, version: 5 } };
      } else if (path.endsWith("/content")) data = { version, content: nativeContent, dependencies: [] };
      else if (path.endsWith("/versions")) data = { items: [version], pagination: { next_cursor: null, has_more: false }, automatic_history_enabled: true };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "version-restore-ui", data } });
    });
    await mountDocumentSurface(page, "collaboration");
    const trigger = page.getByRole("button", { name: "打开评论与历史", exact: true });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "评论与历史" });
    await panel.getByRole("tab", { name: "历史版本" }).click();
    await panel.getByRole("button", { name: "查看版本 评审稿" }).click();
    await expect(panel.getByText("固定版本正文")).toBeVisible();
    await panel.getByRole("button", { name: "恢复此版本" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toContain(`/versions/${versionId}/restore`);
    expect(writes[0].body).toMatchObject({ expected_revision: 4, operation_id: expect.any(String) });
    await expect(panel.getByRole("button", { name: "关闭评论与历史" })).toBeDisabled();
    await expect(panel.getByRole("tab", { name: "评论", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(panel).not.toHaveAttribute("data-ending-style");
    await expect(panel).toHaveCSS("opacity", "1");
    release();
    await expect(panel.getByRole("button", { name: "关闭评论与历史" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
