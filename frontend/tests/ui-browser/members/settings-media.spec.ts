import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Invitation, Member } from "../../../src/features/members/api";
import { readContrasts } from "../fixtures/contrast";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";
import { installSession, user, workspace } from "../fixtures/session";

const now = Date.parse("2026-11-01T00:00:00Z");
const member: Member = { workspace_id: workspace.id, user_id: "00000000-0000-4000-8000-000000000003", email: "member@example.com", display_name: "协作成员", role: "editor", version: 7, created_at_ms: now, updated_at_ms: now };
const updatedMember: Member = { ...member, role: "viewer", version: 8 };
const owner: Member = { workspace_id: workspace.id, user_id: user.id, email: user.email, display_name: "空间所有者", role: "owner", version: 3, created_at_ms: now, updated_at_ms: now };
const pendingInvitation: Invitation = { id: "00000000-0000-4000-8000-000000000004", email: "pending@example.com", role: "editor", status: "pending", expires_at_ms: now + 86_400_000, email_sent: false, email_error_summary: "原投递失败", created_at_ms: now, updated_at_ms: now };
const invitation: Invitation = { ...pendingInvitation, id: "00000000-0000-4000-8000-000000000005", email: "invite@example.com", role: "viewer", email_sent: true, email_error_summary: null };
const pageData = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });
const base = `/api/v1/workspaces/${workspace.id}`;

async function installMembersFixture(page: Page) {
  await installSession(page);
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const memberReads: Member[] = [];
  let inviteAttempts = 0;
  let currentMember = member;
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const body: unknown = method === "GET" ? null : request.postDataJSON();
    requests.push({ method, path, body });
    let data: unknown;
    if (method === "GET" && path === "/api/v1/me") data = user;
    else if (method === "GET" && path === "/api/v1/workspaces") data = pageData([workspace]);
    else if (method === "GET" && path === `${base}/members`) {
      memberReads.push(currentMember);
      data = pageData([owner, currentMember]);
    } else if (method === "GET" && path === `${base}/invitations`) data = pageData(inviteAttempts >= 2 ? [pendingInvitation, invitation] : [pendingInvitation]);
    else if (method === "GET" && path === `${base}/mail-status`) data = { enabled: true };
    else if (method === "GET" && path === `${base}/ownership-transfers/current`) {
      await route.fulfill({ status: 404, json: { code: "NOT_FOUND", message: "没有待确认的所有权转让", request_id: "members-no-transfer", data: null } });
      return;
    } else if (method === "POST" && path === `${base}/invitations`) {
      expect(body).toEqual({ email: invitation.email, role: "viewer" });
      inviteAttempts += 1;
      if (inviteAttempts === 1) {
        await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "邀请服务暂时不可用", request_id: "members-invite-retry", data: null } });
        return;
      }
      expect(inviteAttempts).toBe(2);
      data = invitation;
    } else if (method === "PATCH" && path === `${base}/members/${member.user_id}`) {
      expect(body).toEqual({ role: "viewer", expected_version: 7 });
      currentMember = updatedMember;
      data = updatedMember;
    } else throw new Error(`Unexpected members fixture request: ${method} ${path}`);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "members-settings-media", data } });
  });
  return { requests, memberReads };
}

async function expectRoleOptionFocus(option: Locator) {
  await expect(option).toBeFocused();
  await expect(option).toHaveAttribute("data-highlighted", "");
  const focus = await option.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
  const [contrast] = await readContrasts(option, [null]);
  expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
  return { focus, textContrast: contrast };
}

const profiles = [
  { theme: "light", width: 1280, media: false },
  { theme: "dark", width: 1280, media: false },
  { theme: "light", width: 390, media: false },
  { theme: "dark", width: 390, media: false },
  { theme: "light", width: 1280, media: true },
  { theme: "dark", width: 390, media: true },
] as const;

for (const profile of profiles) test.describe(`members settings ${profile.theme} ${profile.width}px ${profile.media ? "forced colors and reduced motion" : "default"}`, () => {
  test.use({ viewport: { width: profile.width, height: 900 }, hasTouch: profile.width === 390 });
  test("retains keyboard invitations, retry drafts, versioned roles and cancelled removal", async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), profile.theme);
    if (profile.media) await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const fixture = await installMembersFixture(page);
    const evidence: Record<string, unknown> = { profile };
    try {
      await page.goto("/settings/members");
      const content = page.getByRole("region", { name: "主工作区", exact: true });
      await expect(content.getByRole("heading", { name: "成员与权限", exact: true })).toBeVisible();
      const routeContent = page.locator("#workspace-main-content");
      await routeContent.evaluate(async element => {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(element.getAnimations().filter(animation => animation.pending || animation.playState === "running").map(animation => animation.finished));
      });
      await expect(routeContent).toHaveCSS("opacity", "1");
      await expect(content.getByText("2 位活跃成员", { exact: true })).toBeVisible();
      await expect(content.getByText("邀请链接会通过邮件发送。", { exact: true })).toBeVisible();
      await expect(content.getByText(pendingInvitation.email, { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "待确认所有权转让", exact: true })).toHaveCount(0);
      expect(fixture.requests.some(request => request.path === `${base}/ownership-transfers/current`)).toBe(true);

      const form = content.locator(".workbench-member-invite form");
      const email = form.getByRole("textbox", { name: "邮箱", exact: true });
      const role = form.getByRole("combobox", { name: "角色", exact: true });
      const send = form.getByRole("button", { name: "发送邀请", exact: true });
      await expect(send).toBeDisabled();
      const layout = await form.evaluate(element => ({ columns: getComputedStyle(element).gridTemplateColumns.split(" ").length, overflow: element.scrollWidth > element.clientWidth }));
      expect(layout).toEqual({ columns: profile.width === 1280 ? 3 : 1, overflow: false });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      for (const control of [email, role, send]) {
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(profile.width);
      }
      evidence.layout = layout;
      evidence.mutedPaint = await content.locator(".workbench-member-invite p").evaluate(element => {
        const ancestry = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          ancestry.push({ tag: node.tagName, className: node.className, color: style.color, background: style.backgroundColor, opacity: style.opacity, muted: style.getPropertyValue("--ob-muted-foreground"), pageMuted: style.getPropertyValue("--ob-page-muted-foreground") });
        }
        return ancestry;
      });
      evidence.mutedContrast = await readContrasts(content, [".workbench-member-invite p"]);
      const initialAxe = await new AxeBuilder({ page }).analyze();
      evidence.initialAxe = initialAxe.violations;
      expect.soft(initialAxe.violations).toEqual([]);

      await email.focus();
      await page.keyboard.type(invitation.email);
      await page.keyboard.press("Tab");
      evidence.inviteRoleFocus = await expectVisibleKeyboardFocus(role);
      await page.keyboard.press("ArrowDown");
      const options = page.locator('[data-slot="select-content"]');
      const editorOption = options.getByRole("option", { name: "编辑者", exact: true });
      evidence.editorOptionFocus = await expectRoleOptionFocus(editorOption);
      expect((await new AxeBuilder({ page }).include('[data-slot="select-content"]').analyze()).violations).toEqual([]);
      if (profile.media) evidence.optionMotion = await expectNoContinuingMotion(options);
      await page.keyboard.press("End");
      const viewerOption = options.getByRole("option", { name: "只读成员", exact: true });
      evidence.viewerOptionFocus = await expectRoleOptionFocus(viewerOption);
      await page.keyboard.press("Enter");
      await expect(options).toBeHidden();
      await expect(role).toContainText("只读成员");
      evidence.roleReturnFocus = await expectVisibleKeyboardFocus(role);
      await page.keyboard.press("Tab");
      evidence.sendStartingPaint = await send.evaluate(element => { const style = getComputedStyle(element); return { color: style.color, background: style.backgroundColor, outline: style.outline, opacity: style.opacity, transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration, animations: element.getAnimations().map(animation => ({ state: animation.playState, timing: animation.effect?.getComputedTiming() })) }; });
      evidence.sendStartingContrast = await readContrasts(send, [null], "outlineColor");
      await send.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      evidence.sendFocus = await expectVisibleKeyboardFocus(send);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "通知", exact: true }).locator('[data-slot="toast"]').getByText("邀请服务暂时不可用", { exact: true })).toBeVisible();
      await expect(send).toBeEnabled();
      await expect(email).toHaveValue(invitation.email);
      await expect(role).toContainText("只读成员");
      expect(fixture.requests.filter(request => request.method === "POST")).toHaveLength(1);
      const failureToast = page.getByRole("region", { name: "通知", exact: true }).locator('[data-slot="toast"]');
      await page.keyboard.press("F6");
      await expect(page.getByRole("region", { name: "通知", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(failureToast).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(failureToast.getByRole("button", { name: "关闭通知", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(failureToast).toHaveCount(0);

      await email.focus();
      await page.keyboard.press("Tab");
      await expect(role).toBeFocused();
      await page.keyboard.press("Tab");
      await send.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      evidence.retryFocus = await expectVisibleKeyboardFocus(send);
      await page.keyboard.press("Enter");
      await expect(content.getByText(invitation.email, { exact: true })).toBeVisible();
      await expect(email).toHaveValue("");
      await expect(send).toBeDisabled();

      const memberRole = content.getByRole("combobox", { name: `调整 ${member.email} 的角色`, exact: true });
      await memberRole.focus();
      await page.keyboard.press("ArrowDown");
      const memberOptions = page.locator('[data-slot="select-content"]');
      await expect(memberOptions.getByRole("option", { name: "编辑者", exact: true })).toBeFocused();
      await page.keyboard.press("End");
      evidence.memberOptionFocus = await expectRoleOptionFocus(memberOptions.getByRole("option", { name: "只读成员", exact: true }));
      await page.keyboard.press("Enter");
      await expect(memberRole).toContainText("只读成员");
      await expect(memberRole).toBeEnabled();
      expect(fixture.memberReads.at(-1)).toEqual(updatedMember);

      const confirmations: string[] = [];
      page.once("dialog", async dialog => {
        expect(dialog.type()).toBe("confirm");
        confirmations.push(dialog.message());
        await dialog.dismiss();
      });
      const remove = content.getByRole("button", { name: `移除 ${member.email}`, exact: true });
      await remove.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => confirmations.length).toBe(1);
      expect(confirmations).toEqual([`确认移除 ${member.email}？该成员将立即失去工作空间访问权限。`]);
      await expect(memberRole).toBeVisible();
      expect(fixture.requests.filter(request => request.method === "DELETE")).toEqual([]);
      expect(fixture.requests.filter(request => request.method !== "GET")).toEqual([
        { method: "POST", path: `${base}/invitations`, body: { email: invitation.email, role: "viewer" } },
        { method: "POST", path: `${base}/invitations`, body: { email: invitation.email, role: "viewer" } },
        { method: "PATCH", path: `${base}/members/${member.user_id}`, body: { role: "viewer", expected_version: 7 } },
      ]);
      if (profile.media) evidence.pageMotion = await expectNoContinuingMotion(content);
      await page.getByRole("region", { name: "通知", exact: true }).evaluate(async element => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.pending || animation.playState === "running").map(animation => animation.finished.catch(() => {})));
      });
      const finalAxe = await new AxeBuilder({ page }).analyze();
      evidence.finalAxe = finalAxe.violations;
      expect.soft(finalAxe.violations).toEqual([]);
    } finally {
      await info.attach("members-settings-media", { body: JSON.stringify({ ...evidence, ...fixture }, null, 2), contentType: "application/json" });
    }
  });
});
