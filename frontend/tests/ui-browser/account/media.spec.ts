import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";
import type { User } from "../../../src/shared/api/schemas";
import { installHomeFixture, user } from "../fixtures/home";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";

const MAX_TAB_STOPS = 80;
const savedName = "媒体验收成员";
const savedBio = "强制颜色模式下保留的个人简介";

async function readButtonState(target: Locator) {
  return target.evaluate(element => {
    const button = element as HTMLButtonElement;
    return { opacity: Number(getComputedStyle(button).opacity), nativeDisabled: button.disabled, ariaDisabled: button.getAttribute("aria-disabled"), busy: button.getAttribute("aria-busy") === "true", focused: document.activeElement === button };
  });
}

for (const profile of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) test.describe(`account media ${profile.theme} ${profile.width}px`, () => {
  test.use({ viewport: { width: profile.width, height: 900 }, hasTouch: profile.width === 390 });
  test("forced colors and reduced motion preserve keyboard drafts, pending focus and failed-save retry", async ({ page }, info) => {
    await installHomeFixture(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), profile.theme);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const writes: Array<{ display_name: string | null; bio: string | null; expected_version: number }> = [];
    const requests: Array<{ method: string; path: string }> = [];
    let serverProfile: User = { ...user };
    let completeRequest: () => void = () => {};
    const pending = new Promise<void>(resolve => { completeRequest = resolve; });
    await page.route("**/api/v1/me", async route => {
      const request = route.request();
      requests.push({ method: request.method(), path: new URL(request.url()).pathname });
      if (request.method() === "PATCH") {
        writes.push(request.postDataJSON());
        if (writes.length === 1) {
          await pending;
          await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "保存暂不可用", request_id: "account-media", data: null } });
          return;
        }
        serverProfile = { ...user, display_name: savedName, bio: savedBio, profile_version: user.profile_version + 1 };
        await route.fulfill({ json: { code: "OK", message: "保存成功", request_id: "account-media", data: serverProfile } });
      } else {
        expect(request.method()).toBe("GET");
        await route.fulfill({ json: { code: "OK", message: "", request_id: "account-media", data: serverProfile } });
      }
    });
    const evidence: Record<string, unknown> = { profile, forcedColors: "active", reducedMotion: "reduce", baseVersion: user.profile_version, writes, requests };
    try {
      await page.goto("/settings/account");
      await expect(page.locator("html")).toHaveAttribute("data-theme", profile.theme);
      await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
      const region = page.getByRole("region", { name: "个人资料", exact: true });
      const name = region.getByRole("textbox", { name: "名称", exact: true });
      const bio = region.getByRole("textbox", { name: "个人简介", exact: true });
      await expect(name).toHaveValue(user.display_name);
      await expect(bio).toHaveValue("");
      for (let stop = 0; stop < MAX_TAB_STOPS && !await name.evaluate(element => element === document.activeElement); stop++) await page.keyboard.press("Tab");
      evidence.nameFocus = await expectVisibleKeyboardFocus(name);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(savedName);
      await page.keyboard.press("Tab");
      evidence.bioFocus = await expectVisibleKeyboardFocus(bio);
      await page.keyboard.type(savedBio);
      await page.keyboard.press("Tab");
      const save = region.getByRole("button", { name: "保存资料", exact: true });
      evidence.saveFocus = await expectVisibleKeyboardFocus(save);
      evidence.draftMotion = await expectNoContinuingMotion(region);
      const draftAccessibility = await new AxeBuilder({ page }).analyze();
      evidence.draftAccessibility = draftAccessibility.violations;
      expect(draftAccessibility.violations).toEqual([]);
      await page.keyboard.press("Enter");
      await expect.poll(() => writes.length).toBe(1);
      const loading = region.getByRole("button", { name: "保存中…", exact: true });
      await expect(loading).toHaveAttribute("aria-disabled", "true");
      await expect(name).toBeDisabled();
      await expect(bio).toBeDisabled();
      evidence.pendingFocus = await expectVisibleKeyboardFocus(loading);
      evidence.pendingAppearance = await readButtonState(loading);
      expect(evidence.pendingAppearance).toMatchObject({ focused: true, nativeDisabled: false, ariaDisabled: "true", busy: true });
      const avatar = region.getByRole("button", { name: "更换头像", exact: true });
      await expect(avatar).toBeDisabled();
      evidence.nativeDisabledAppearance = await readButtonState(avatar);
      expect(evidence.nativeDisabledAppearance).toMatchObject({ nativeDisabled: true, busy: false });
      await page.keyboard.press("Tab");
      await expect(loading).not.toBeFocused();
      evidence.unfocusedLoadingAppearance = await readButtonState(loading);
      expect(evidence.unfocusedLoadingAppearance).toMatchObject({ nativeDisabled: false, ariaDisabled: "true", busy: true, focused: false });
      await page.keyboard.press("Shift+Tab");
      evidence.pendingReturnFocus = await expectVisibleKeyboardFocus(loading);
      expect(await readButtonState(loading)).toMatchObject({ focused: true, nativeDisabled: false, busy: true });
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      evidence.pendingMotion = await expectNoContinuingMotion(region);
      expect(writes).toHaveLength(1);
      completeRequest();
      await expect(save).toBeEnabled();
      await expect(name).toBeEnabled();
      await expect(bio).toBeEnabled();
      await expect(name).toHaveValue(savedName);
      await expect(bio).toHaveValue(savedBio);
      const failureToast = page.getByRole("region", { name: "通知", exact: true }).locator('[data-slot="toast"]');
      await expect(failureToast).toHaveCount(1);
      await expect(failureToast).toBeVisible();
      await expect(failureToast).toContainText("保存暂不可用");
      evidence.failedSaveFocus = await expectVisibleKeyboardFocus(save);
      const failedUser = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).user);
      evidence.failedUser = failedUser;
      expect(failedUser).toMatchObject({ display_name: user.display_name, bio: user.bio, profile_version: user.profile_version });
      evidence.failureMotion = await expectNoContinuingMotion(region);
      const idleFailureAccessibility = await new AxeBuilder({ page }).analyze();
      evidence.idleFailureAccessibility = idleFailureAccessibility.violations;
      expect(idleFailureAccessibility.violations).toEqual([]);
      await page.keyboard.press("F6");
      await expect(page.getByRole("region", { name: "通知", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(failureToast).toBeFocused();
      await page.keyboard.press("Tab");
      const closeFailure = failureToast.getByRole("button", { name: "关闭通知", exact: true });
      await expect(closeFailure).toBeFocused();
      // Base UI 原生哨兵同步转移 Tab 焦点，不能停留；维护者确认此行为：mui/base-ui#4668、#4845。
      const failureAccessibility = await new AxeBuilder({ page }).exclude("[data-base-ui-focus-guard]").analyze();
      evidence.failureAccessibility = failureAccessibility.violations;
      expect(failureAccessibility.violations).toEqual([]);
      await page.keyboard.press("Tab");
      await expect(save).toBeFocused();
      await expect(page.locator("[data-base-ui-focus-guard]:focus")).toHaveCount(0);
      await page.keyboard.press("F6");
      await page.keyboard.press("Tab");
      await expect(failureToast).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(closeFailure).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(failureToast).toHaveCount(0);
      await save.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => writes.length).toBe(2);
      await expect(save).toBeEnabled();
      const expected = { display_name: savedName, bio: savedBio, expected_version: user.profile_version };
      expect(writes).toEqual([expected, expected]);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).user.profile_version)).toBe(user.profile_version + 1);
      const confirmedUser = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).user);
      evidence.confirmedUser = confirmedUser;
      expect(confirmedUser).toMatchObject({ display_name: savedName, bio: savedBio, profile_version: user.profile_version + 1 });
      await expect(name).toHaveValue(savedName);
      await expect(bio).toHaveValue(savedBio);
      evidence.confirmedFocus = await expectVisibleKeyboardFocus(save);
      evidence.confirmedMotion = await expectNoContinuingMotion(region);
      await page.reload();
      await expect(name).toHaveValue(savedName);
      await expect(bio).toHaveValue(savedBio);
      await expect(name).toBeEnabled();
      await expect(bio).toBeEnabled();
      expect(writes).toHaveLength(2);
      evidence.restoredUser = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).user);
      expect(evidence.restoredUser).toMatchObject({ display_name: savedName, bio: savedBio, profile_version: user.profile_version + 1 });
      evidence.restoredMotion = await expectNoContinuingMotion(region);
      const restoredAccessibility = await new AxeBuilder({ page }).analyze();
      evidence.restoredAccessibility = restoredAccessibility.violations;
      expect(restoredAccessibility.violations).toEqual([]);
    } finally {
      completeRequest();
      await info.attach("account-media", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    }
  });
});
