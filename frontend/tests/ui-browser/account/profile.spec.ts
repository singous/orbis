import { expect, test } from "@playwright/test";

import { installSession } from "../fixtures/session";
import { user } from "../fixtures/session";

// 仅替代 HTTP 边界；页面、会话、请求解析、表单和通知使用真实实现。
test("profile draft survives a failed save and retry retains the expected version", async ({ page }) => {
  await installSession(page);
  const writes: unknown[] = [];
  let completeRequest: () => void = () => {};
  const pending = new Promise<void>(resolve => { completeRequest = resolve; });
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/api/v1/me") {
      if (request.method() === "PATCH") {
        writes.push(request.postDataJSON());
        if (writes.length === 1) {
          await pending;
          await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "保存暂不可用", request_id: "ui-test", data: null } });
        } else await route.fulfill({ json: { code: "OK", message: "保存成功", request_id: "ui-test", data: { ...user, display_name: "新名称", bio: "新简介", profile_version: 4 } } });
      } else await route.fulfill({ json: { code: "OK", message: "", request_id: "ui-test", data: user } });
      return;
    }
    await route.fulfill({ json: { code: "OK", message: "", request_id: "ui-test", data: { items: [], pagination: { page: 1, page_size: 20, total: 0 } } } });
  });
  await page.goto("/settings/account");
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("原名称");
  await page.getByLabel("名称", { exact: true }).fill("新名称");
  await page.getByLabel("个人简介", { exact: true }).fill("新简介");
  const save = page.getByRole("button", { name: "保存资料" });
  await save.click();
  const loading = page.getByRole("button", { name: "保存中…" });
  await expect(loading).toBeFocused();
  await expect(loading).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect.poll(() => writes.length).toBe(1);
  completeRequest();
  await expect(page.getByRole("button", { name: "保存资料" })).toBeEnabled();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("新名称");
  await expect(page.getByLabel("个人简介", { exact: true })).toHaveValue("新简介");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes).toEqual(Array(2).fill({ display_name: "新名称", bio: "新简介", expected_version: 3 }));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).user.profile_version)).toBe(4);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("button", { name: "保存资料" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
