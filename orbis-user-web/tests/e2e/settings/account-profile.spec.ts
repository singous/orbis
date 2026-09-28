import { expect, test } from "@playwright/test";

test("profile edits and a custom avatar persist across all personal surfaces", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "Profile owner" } });
  expect([201, 409]).toContain(setup.status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const headers = { Authorization: `Bearer ${token}` };
  const original = (await (await request.get("/api/users/me", { headers })).json()).data;
  try {
  await page.goto("/settings/account");
  await page.getByLabel("名称", { exact: true }).fill("彩色头像用户");
  await page.getByLabel("个人简介", { exact: true }).fill("记录思考与知识");
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "彩色头像用户", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("个人简介", { exact: true })).toHaveValue("记录思考与知识");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAALElEQVR4nGN8FcHDQA3ARBVTGEYNIgaMBjZhMBpGhMFoGBEGo2FEGAy+MAIAl7EBfoz1A8UAAAAASUVORK5CYII=", "base64") });
  await expect(page.locator(".workbench-profile-avatar img")).toBeVisible();
  await expect(page.locator(".workspace-user-trigger img")).toBeVisible();
  const savedAvatar = await page.locator(".workspace-user-trigger img").getAttribute("src");
  await fileInput.setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken image") });
  await expect(page.getByText("头像更新失败", { exact: true })).toBeVisible();
  await expect(page.locator(".workspace-user-trigger img")).toHaveAttribute("src", savedAvatar!);
  await page.reload();
  await expect(page.locator(".workspace-user-trigger img")).toBeVisible();
  await page.getByRole("button", { name: "切换工作空间", exact: true }).click();
  await expect(page.locator(".workspace-switcher-avatar img")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "移除头像", exact: true }).click();
  await expect(page.locator(".workbench-profile-avatar img")).toHaveCount(0);
  await expect(page.locator(".workspace-user-trigger img")).toHaveCount(0);
  const backgrounds = await page.locator(".workbench-profile-avatar, .workspace-user-avatar").evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
  expect(new Set(backgrounds).size).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await request.patch("/api/users/me", { headers, data: { display_name: original.display_name, bio: original.bio } });
    await request.delete("/api/users/me/avatar", { headers });
  }
});
