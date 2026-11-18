import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";

const MAX_RETRY_TAB_STOPS = 8;

for (const profile of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) test.describe(`public form media ${profile.theme} ${profile.width}px`, () => {
  test.use({ viewport: { width: profile.width, height: 900 }, hasTouch: profile.width === 390 });
  test("forced colors and reduced motion preserve keyboard answers and the original retry intent", async ({ page }, info) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), profile.theme);
    const submissions: Array<{ operation_id: string; version: number; values: Record<string, unknown> }> = [];
    const requests: Array<{ method: string; path: string; authorization?: string }> = [];
    await page.route("**/api/v1/public/forms/form-token**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      requests.push({ method: request.method(), path, authorization: request.headers().authorization });
      if (path.endsWith("/submissions")) {
        expect(request.method()).toBe("POST");
        submissions.push(request.postDataJSON());
        await route.fulfill({ status: submissions.length === 1 ? 503 : 200, json: { code: submissions.length === 1 ? "UNAVAILABLE" : "OK", message: submissions.length === 1 ? "请重试原提交" : "", request_id: "public-form-media", data: submissions.length === 1 ? null : { id: "record-1" } } });
      } else {
        expect(request.method()).toBe("GET");
        const data = { id: "form-1", version: 4, config: { title: "活动报名", description: "请填写报名资料", fields: [{ field_id: "name", required: true, description: "请输入姓名" }, { field_id: "status", required: false, description: "" }] }, fields: [{ id: "name", name: "姓名", kind: "text", options: [], default: null }, { id: "status", name: "状态", kind: "select", options: [{ id: "open", label: "进行中", color: "green" }, { id: "done", label: "已完成", color: "blue" }], default: null }] };
        await route.fulfill({ json: { code: "OK", message: "", request_id: "public-form-media", data } });
      }
    });
    const evidence: Record<string, unknown> = { profile, forcedColors: "active", reducedMotion: "reduce" };
    try {
      await page.goto("/forms/form-token");
      await expect(page.getByRole("heading", { name: "活动报名", exact: true })).toBeVisible();
      const name = page.getByRole("textbox", { name: "姓名", exact: true });
      await page.keyboard.press("Tab");
      evidence.nameFocus = await expectVisibleKeyboardFocus(name);
      await page.keyboard.type("报名成员");
      await page.keyboard.press("Tab");
      const choice = page.getByRole("radio", { name: "进行中", exact: true });
      evidence.choiceFocus = await expectVisibleKeyboardFocus(choice);
      await page.keyboard.press("Space");
      await expect(choice).toBeChecked();
      await expect(page.getByRole("radio", { name: "已完成", exact: true })).not.toBeChecked();
      await page.keyboard.press("Tab");
      const submit = page.getByRole("button", { name: "提交", exact: true });
      evidence.submitFocus = await expectVisibleKeyboardFocus(submit);
      evidence.formMotion = await expectNoContinuingMotion(page.getByRole("main"));
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.keyboard.press("Enter");
      const retry = page.getByRole("button", { name: "重试提交", exact: true });
      await expect(retry).toBeEnabled();
      await expect.poll(() => submissions.length).toBe(1);
      await expect(name).toHaveValue("报名成员");
      await expect(choice).toBeChecked();
      for (let stop = 0; stop < MAX_RETRY_TAB_STOPS && !await retry.evaluate(element => element === document.activeElement); stop++) await page.keyboard.press("Tab");
      evidence.retryFocus = await expectVisibleKeyboardFocus(retry);
      const receipt = await page.evaluate(() => JSON.parse(sessionStorage.getItem("orbis.sheet-submission:form-token") ?? "null"));
      evidence.receipt = receipt;
      expect(receipt).toEqual(submissions[0]);
      expect(receipt).toMatchObject({ version: 4, values: { name: "报名成员", status: "open" } });
      expect(receipt.operation_id).toMatch(/^[0-9a-f-]{36}$/);
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(name).toBeFocused();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("不替换原提交");
      await expect(name).toHaveValue("报名成员");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      evidence.retryReturnFocus = await expectVisibleKeyboardFocus(retry);
      evidence.retryMotion = await expectNoContinuingMotion(page.getByRole("main"));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "提交成功", exact: true })).toBeVisible();
      expect(submissions).toHaveLength(2);
      expect(submissions[1]).toEqual(submissions[0]);
      expect(await page.evaluate(() => sessionStorage.getItem("orbis.sheet-submission:form-token"))).toBeNull();
      expect(requests.every(request => request.authorization === undefined)).toBe(true);
      evidence.successMotion = await expectNoContinuingMotion(page.getByRole("main"));
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await info.attach("public-form-media", { body: JSON.stringify({ ...evidence, submissions, requests }, null, 2), contentType: "application/json" });
    }
  });
});
