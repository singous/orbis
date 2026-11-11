import { expectVisibleKeyboardFocus } from "../fixtures/media";
import { appendFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installSession, pagination, user, workspace } from "../fixtures/session";

const transfer = { id: "00000000-0000-4000-8000-000000000003", from_user_id: user.id, target_user_id: "00000000-0000-4000-8000-000000000004", status: "confirmed", expires_at_ms: 10000, email_sent: true, email_error_summary: null, confirmed_at_ms: 2, cancelled_at_ms: null, created_at_ms: 1, updated_at_ms: 2 };

async function evidence(page: Page, state: string, theme: string, width: number) {
  if (!process.env.ORBIS_MEMBER_EVIDENCE) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
  });
  const values = await page.locator(".orbis-auth-layout").evaluate(element => {
    const selectors = [":scope", ".orbis-auth-card", ".orbis-auth-card>div:first-child", "h1", "p", "form", "label", "input", "button", "a"];
    return selectors.flatMap(selector => (selector === ":scope" ? [element] : Array.from(element.querySelectorAll(selector))).map((node, index) => {
      const css = getComputedStyle(node), box = node.getBoundingClientRect();
      return { selector, index, x: box.x, y: box.y, width: box.width, height: box.height, display: css.display, background: css.backgroundColor, color: css.color, border: css.border, radius: css.borderRadius, shadow: css.boxShadow, padding: css.padding, margin: css.margin, gap: css.gap, fontSize: css.fontSize, fontWeight: css.fontWeight, lineHeight: css.lineHeight, letterSpacing: css.letterSpacing };
    }));
  });
  appendFileSync(process.env.ORBIS_MEMBER_EVIDENCE, JSON.stringify({ state, theme, width, values }) + "\n");
}

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test(`${theme} ${width}px member entries retain their material, requests and state`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.setViewportSize({ width, height: 900 });
  const accepts: unknown[] = [], confirmations: unknown[] = [], inspections: unknown[] = [];
  let releaseAccept!: () => void, releaseConfirm!: () => void;
  const accepting = new Promise<void>(resolve => { releaseAccept = resolve; });
  const confirming = new Promise<void>(resolve => { releaseConfirm = resolve; });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/invitations/inspect")) {
      inspections.push(route.request().postDataJSON());
      await route.fulfill({ json: { code: "OK", message: "", request_id: "member-inspection", data: { workspace_name: workspace.name, email: user.email, role: "editor", account_exists: false, expires_at_ms: 10000 } } });
    } else if (path.endsWith("/invitations/accept")) {
      accepts.push(route.request().postDataJSON());
      if (accepts.length === 1) {
        await accepting;
        await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "邀请验证服务暂时不可用", request_id: "member-retry", data: null } });
      } else await route.fulfill({ json: { code: "OK", message: "", request_id: "member-accepted", data: { user, member: { workspace_id: workspace.id, version: 1, user_id: user.id, email: user.email, display_name: "受邀成员", role: "editor", created_at_ms: 1, updated_at_ms: 1 }, session: null } } });
    } else if (path.endsWith("/ownership-transfers/confirm")) {
      confirmations.push(route.request().postDataJSON());
      if (confirmations.length === 1) {
        await confirming;
        await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "所有权确认服务暂时不可用", request_id: "ownership-retry", data: null } });
      } else await route.fulfill({ json: { code: "OK", message: "", request_id: "ownership-confirmed", data: transfer } });
    } else await route.fulfill({ json: { code: "OK", message: "", request_id: "member-fallback", data: null } });
  });
  await page.goto("/invite/path-token?token=query-token#token=invitation-token");
  const card = page.locator(".orbis-auth-card");
  await expect(page.getByRole("heading", { name: "接受成员邀请", exact: true })).toBeVisible();
  await expect(card).toBeInViewport();
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText(`工作空间：${workspace.name} · ${user.email}`)).toBeVisible();
  await evidence(page, "invitation", theme, width);
  await page.keyboard.press("Tab");
  const name = page.getByRole("textbox", { name: "显示名称", exact: true });
  const password = page.getByLabel("设置密码", { exact: true });
  await expect(name).toBeFocused();
  await name.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await expectVisibleKeyboardFocus(name);
  await name.fill("受邀成员");
  await page.keyboard.press("Tab");
  await expect(password).toBeFocused();
  await password.fill("initial-password");
  await page.keyboard.press("Tab");
  const accept = page.getByRole("button", { name: "确认加入", exact: true });
  await expect(accept).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(accept).toBeDisabled();
  await expect.poll(() => accepts.length).toBe(1);
  await evidence(page, "invitation-pending", theme, width);
  releaseAccept();
  await expect(accept).toBeEnabled();
  await expect(page.getByRole("region", { name: "通知", exact: true }).locator('[data-slot="toast"]').filter({ hasText: "邀请验证服务暂时不可用" })).toBeVisible();
  await expect(name).toHaveValue("受邀成员");
  await expect(password).toHaveValue("initial-password");
  await evidence(page, "invitation-failed", theme, width);
  await accept.click();
  await expect(page.getByRole("heading", { name: "已加入工作空间", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往登录", exact: true })).toHaveAttribute("href", "/login");
  expect(inspections).toEqual([{ token: "invitation-token" }]);
  expect(accepts).toEqual(Array(2).fill({ token: "invitation-token", password: "initial-password", display_name: "受邀成员" }));
  await evidence(page, "invitation-success", theme, width);
  expect((await new AxeBuilder({ page }).include(".orbis-auth-layout").analyze()).violations).toEqual([]);
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.goto("/ownership-transfer/path-transfer?token=query-transfer#token=transfer-token");
  await expect(page.getByRole("heading", { name: "确认转让工作空间", exact: true })).toBeVisible();
  await evidence(page, "ownership", theme, width);
  const confirm = page.getByRole("button", { name: "确认所有权转让", exact: true });
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect.poll(() => confirmations.length).toBe(1);
  await evidence(page, "ownership-pending", theme, width);
  releaseConfirm();
  await expect(confirm).toBeEnabled();
  await expect(page.getByRole("region", { name: "通知", exact: true }).locator('[data-slot="toast"]').filter({ hasText: "所有权确认服务暂时不可用" })).toBeVisible();
  await evidence(page, "ownership-failed", theme, width);
  await confirm.click();
  await expect(page.getByRole("heading", { name: "所有权已完成转让", exact: true })).toBeVisible();
  expect(confirmations).toEqual([{ token: "transfer-token" }, { token: "transfer-token" }]);
  await expect(page.getByRole("link", { name: "重新登录", exact: true })).toHaveAttribute("href", "/login");
  await evidence(page, "ownership-success", theme, width);
  expect((await new AxeBuilder({ page }).include(".orbis-auth-layout").analyze()).violations).toEqual([]);
});

test("existing-account invitation and disabled missing-token routes retain their actions", async ({ page }) => {
  await page.route("**/invitations/inspect", route => route.fulfill({ json: { code: "OK", message: "", request_id: "existing-invitation", data: { workspace_name: workspace.name, email: user.email, role: "viewer", account_exists: true, expires_at_ms: 10000 } } }));
  await page.goto("/invitations/accept?token=existing-token");
  await expect(page.getByRole("link", { name: "登录受邀账号后继续", exact: true })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("textbox", { name: "显示名称", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认加入", exact: true })).toBeDisabled();
  await page.goto("/invitations/accept");
  await expect(page.getByRole("button", { name: "确认加入", exact: true })).toBeDisabled();
  await page.goto("/ownership-transfers/confirm");
  await expect(page.getByRole("button", { name: "确认所有权转让", exact: true })).toBeDisabled();
});

test("a signed-in account accepts with its token and enters the returned workspace", async ({ page }) => {
  await installSession(page);
  const accepted: Array<{ body: unknown; authorization?: string }> = [];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { items: [], pagination };
    if (path.endsWith("/invitations/inspect")) data = { workspace_name: workspace.name, email: user.email, role: "editor", account_exists: true, expires_at_ms: 10000 };
    else if (path.endsWith("/invitations/accept")) {
      accepted.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization });
      data = { user, member: { workspace_id: workspace.id, version: 1, user_id: user.id, email: user.email, display_name: user.display_name, role: "editor", created_at_ms: 1, updated_at_ms: 1 }, session: null };
    } else if (path.endsWith("/workspaces")) data = { items: [workspace], pagination: { ...pagination, total: 1 } };
    else if (path.endsWith("/me")) data = user;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "signed-in-invitation", data } });
  });
  await page.goto("/invitations/accept#token=signed-in-token");
  await expect(page.getByText("使用当前登录账号确认加入受邀工作空间。", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "显示名称", exact: true })).toHaveCount(0);
  const accept = page.getByRole("button", { name: "确认加入", exact: true });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByRole("heading", { name: "我的文档", exact: true })).toBeVisible();
  expect(accepted).toEqual([{ body: { token: "signed-in-token" }, authorization: "Bearer test-token" }]);
});

test.describe("coarse member entry accessibility", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  test("keeps native field sizing, keyboard focus and disabled actions with forced colors and reduced motion", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orbis.appearance", "dark"));
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto("/invitations/accept");
    const name = page.getByRole("textbox", { name: "显示名称", exact: true });
    await expect(name).toBeVisible();
    await expect(name).toHaveCSS("font-size", "16px");
    expect((await name.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    await name.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await expectVisibleKeyboardFocus(name);

    await expect(page.getByRole("button", { name: "确认加入", exact: true })).toBeDisabled();
    expect((await page.getByRole("button", { name: "确认加入", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(24);
    expect(await page.locator(".orbis-auth-layout").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.goto("/ownership-transfer/forced-colors-token");
    const confirm = page.getByRole("button", { name: "确认所有权转让", exact: true });
    await expect(confirm).toBeVisible();
    expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(24);
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await expectVisibleKeyboardFocus(confirm);
    expect((await new AxeBuilder({ page }).include(".orbis-auth-layout").analyze()).violations).toEqual([]);
  });
});
