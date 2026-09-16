import { expect, test } from "@playwright/test";

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const notebookTitle = "图标端到端验证";
const groupName = "图标验收分组";
const iconPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAF0lEQVR4nGNUW9PJQAgwEVQxqmgAggAAbWUBcxRSQZwAAAAASUVORK5CYII=", "base64");

test("notebook icons persist through preset creation, group folding, image upload and reset", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/setup");
  await page.getByLabel("显示名称", { exact: true }).fill("图标测试工作空间");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  const setupResponse = page.waitForResponse((response) => response.url().endsWith("/api/setup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并进入工作空间", exact: true }).click();
  const initialized = await setupResponse;
  if (initialized.status() === 409) {
    expect((await initialized.json()).code).toBe("SYSTEM_ALREADY_INITIALIZED");
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
    await page.getByLabel("密码", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  } else {
    expect(initialized.status()).toBe(201);
  }
  await expect(page).toHaveURL(/\/documents$/);

  async function readNotebook(id: string) {
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
    const response = await request.get("/api/notebooks?page_size=100", { headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok()).toBe(true);
    return (await response.json()).data.items.find((notebook: { id: string }) => notebook.id === id);
  }

  await page.goto("/documents/collections");
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  await page.getByLabel("分组名称", { exact: true }).fill(groupName);
  await page.getByRole("button", { name: "创建分组", exact: true }).click();
  const group = page.locator(".workbench-collection-group").filter({ has: page.locator(".workbench-group-name").filter({ hasText: groupName }) });
  await group.getByRole("button", { name: "+ 笔记本", exact: true }).click();
  await page.getByLabel("笔记本名称", { exact: true }).fill(notebookTitle);
  await page.getByRole("radio", { name: "灵感", exact: true }).click();
  await page.getByRole("radio", { name: "琥珀黄", exact: true }).click();
  await page.getByRole("button", { name: "创建笔记本", exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
  const notebookId = page.url().split("/").pop()!;
  expect((await readNotebook(notebookId)).icon).toEqual({ type: "preset", name: "lightbulb", color: "amber" });

  await page.goto("/documents/collections");
  const card = page.locator(".workbench-collection-card").filter({ hasText: notebookTitle });
  await expect(card.locator(".notebook-icon--amber .lucide-lightbulb")).toBeVisible();
  await group.getByRole("button", { name: `收起分组 ${groupName}`, exact: true }).click();
  await expect(card).toBeHidden();
  await expect(group.getByRole("button", { name: `展开分组 ${groupName}`, exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.goto("/home");
  await page.goto("/documents/collections");
  await expect(card).toBeHidden();
  await group.getByRole("button", { name: `展开分组 ${groupName}`, exact: true }).click();
  await expect(card.locator(".notebook-icon--amber .lucide-lightbulb")).toBeVisible();

  await card.getByRole("button", { name: `编辑笔记本 ${notebookTitle}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑笔记本", exact: true });
  await expect(dialog.getByRole("radio", { name: "灵感", exact: true })).toHaveAttribute("aria-checked", "true");
  await dialog.getByLabel("上传自定义图标", { exact: true }).setInputFiles({ name: "mint-icon.png", mimeType: "image/png", buffer: iconPng });
  const preview = dialog.getByAltText("自定义笔记本图标", { exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  const savedImage = (await readNotebook(notebookId)).icon;
  expect(savedImage).toEqual({ type: "image", file_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });

  await page.reload();
  const image = card.getByAltText("自定义笔记本图标", { exact: true });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /^data:image\/webp;base64,/);
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect((await readNotebook(notebookId)).icon).toEqual(savedImage);

  await card.getByRole("button", { name: `编辑笔记本 ${notebookTitle}`, exact: true }).click();
  await dialog.getByRole("button", { name: "恢复默认图标", exact: true }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await readNotebook(notebookId)).icon).toBeNull();
  await page.reload();
  await expect(card.locator(".notebook-icon--blue .lucide-book-open")).toBeVisible();
  await expect(card.getByAltText("自定义笔记本图标", { exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
