import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const workspaceId = "00000000-0000-4000-8000-000000000002";
const user = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", display_name: "测试成员", bio: null, avatar_asset_id: null, preferred_workspace_id: workspaceId, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: workspaceId, name: "测试空间", role: "viewer", created_at_ms: 1, updated_at_ms: 1 };
const results = ["服务端第二名", "服务端第一名"].map((title, index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 3}`, type: "document", workspace_id: workspaceId, title, location: "测试笔记本", snippet: "检索内容", match: "body", matched_comment_id: null, status: "active", updated_at_ms: index + 1, collection_id: null, group_id: null }));

for (const theme of ["light", "dark"] as const) test(`home search in ${theme} keeps palette geometry, server ordering, filters, IME and return focus`, async ({ page }) => {
  const requests: URL[] = [];
  await page.addInitScript(({ user, workspace, theme }) => { localStorage.setItem("orbis.appearance", theme); localStorage.setItem("orbis.auth.v2", JSON.stringify({ user, workspace, accessToken: "search-test", refreshToken: "search-refresh", credentialID: "search-session" })); }, { user, workspace, theme });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = { items: [], pagination: { page: 1, page_size: 20, total: 0 } };
    if (url.pathname.endsWith("/search")) {
      requests.push(url);
      data = { items: results, pagination: { page: Number(url.searchParams.get("page")), page_size: 20, total: 21 } };
    } else if (url.pathname.endsWith("/quick-notes/summary")) data = { total: 0, untagged: 0, deleted: 0 };
    else if (url.pathname === "/api/v1/me") data = user;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "palette-ui-test", data } });
  });
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "首页", exact: true })).toBeVisible();
  const homeSearch = page.getByRole("searchbox", { name: "搜索文档" });
  await homeSearch.focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
  const input = palette.getByRole("combobox", { name: "搜索任何内容" });
  await expect(input).toBeFocused();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const box = (await palette.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeLessThanOrEqual(900);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(palette.getByRole("option")).toHaveCount(4);
  await input.fill("@doc 检索");
  await expect(palette.getByRole("option")).toHaveCount(2);
  await expect(palette.getByRole("option").first()).toContainText("服务端第二名");
  await expect(palette.getByRole("option").last()).toContainText("服务端第一名");
  const firstResult = palette.getByRole("option").first();
  expect(await firstResult.evaluate(element => element.tagName)).toBe("A");
  await expect(firstResult).toHaveAttribute("tabindex", "-1");
  await expect(firstResult).toHaveAttribute("href", `/documents/${results[0].id}`);
  await expect(input).toHaveAttribute("aria-activedescendant", await firstResult.getAttribute("id") ?? "");
  await expect(firstResult).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-activedescendant", await palette.getByRole("option").last().getAttribute("id") ?? "");
  await expect(palette.getByRole("option").last()).toHaveAttribute("aria-selected", "true");
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await palette.getByRole("button", { name: "下一页" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  expect(requests.at(-1)?.searchParams.get("type")).toBe("document");
  const status = palette.getByRole("combobox", { name: "内容状态" });
  await status.click();
  await expect(page.getByRole("option", { name: "已归档", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeVisible();
  await expect(status).toBeFocused();
  await status.click();
  await page.getByRole("option", { name: "已归档", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("status")).toBe("archived");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  await input.focus();
  await input.dispatchEvent("compositionstart", { data: "中" });
  await page.keyboard.press("Escape");
  await expect(palette).toBeVisible();
  await input.dispatchEvent("compositionend", { data: "中" });
  await expect.poll(() => palette.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(homeSearch).toBeFocused();
  await expect(page).toHaveURL(/\/home$/);
});
