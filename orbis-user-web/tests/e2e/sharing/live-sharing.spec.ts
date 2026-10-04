import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });
const credentials = {
  email: "owner@example.com",
  password: "Orbis-browser-test-2026!",
};
const webOrigin = `http://127.0.0.1:${process.env.ORBIS_E2E_WEB_PORT || "9310"}`;
const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

test("independent notebook and subtree links read current online documents and enforce live revocation", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect([201, 409]).toContain(
    (
      await request.post("/api/setup", {
        data: { ...credentials, display_name: "Live sharing acceptance" },
      })
    ).status(),
  );
  const login = await request.post("/api/auth/login", { data: credentials });
  expect(login.status()).toBe(200);
  const auth = (await login.json()).data;
  const headers = {
    Authorization: `Bearer ${auth.access_token}`,
    "X-Workspace-ID": auth.workspace.id,
  };
  const createdBook = await request.post("/api/notebooks", {
    headers,
    data: { title: "实时分享验收笔记本" },
  });
  expect(createdBook.status()).toBe(201);
  const book = (await createdBook.json()).data;
  async function createNote(title: string, parentId: string | null = null) {
    const response = await request.post("/api/notes", {
      headers,
      data: { notebook_id: book.id, title, parent_id: parentId },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  }
  async function save(id: string, blocks: unknown[]) {
    const current = (
      await (await request.get(`/api/notes/${id}/content`, { headers })).json()
    ).data;
    const response = await request.put(`/api/notes/${id}/content`, {
      headers,
      data: {
        expected_version: current.content_version,
        blocks: { schema_version: 2, editor: "blocknote", blocks },
      },
    });
    expect(response.status()).toBe(200);
  }
  const root = await createNote("分享目录根");
  const child = await createNote("下级在线文档", root.id);
  const nested = await createNote("三级目录文档", child.id);
  const privateNote = await createNote("范围外文档");
  const initialBlocks = Array.from({ length: 80 }, (_, index) =>
    paragraph(`live-${index}`, `在线正文第 ${index} 段`),
  );
  const bodyLinks = [
    {
      type: "link",
      href: `/documents/${child.id}`,
      content: [{ type: "text", text: "正文内前往子文档" }],
    },
    {
      type: "link",
      href: `${webOrigin}/documents/${nested.id}`,
      content: [{ type: "text", text: "正文内前往三级文档" }],
    },
    {
      type: "link",
      href: `${webOrigin}/documents/${privateNote.id}`,
      content: [{ type: "text", text: "正文中范围外引用" }],
    },
  ];
  await save(root.id, [
    {
      ...initialBlocks[0],
      content: [...initialBlocks[0].content, ...bodyLinks],
    },
    ...initialBlocks.slice(1),
  ]);
  await save(child.id, [paragraph("child-current", "创建链接时的当前正文")]);
  await save(nested.id, [paragraph("nested-current", "三级正文")]);
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto(`/documents/${root.id}`);
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await expect(page.getByText(/未来新增或移入的文档也会公开/)).toBeVisible();
  const sharing = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/shares") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建公开链接", exact: true }).click();
  const shareResponse = await sharing;
  expect(shareResponse.status()).toBe(201);
  const link = (await shareResponse.json()).data;
  expect(link.root_note_id).toBe(root.id);
  await expect(page.getByLabel("公开链接", { exact: true })).toHaveValue(
    new URL(link.path, page.url()).href,
  );
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "分享", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "复制已有分享链接", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  reader.on("pageerror", (error) => errors.push(error.message));
  const publicRequests: string[] = [];
  const privateMetadataRequests: string[] = [];
  reader.on("request", (req) => {
    if (req.url().includes("/api/notes/"))
      privateMetadataRequests.push(req.url());
    if (req.url().includes("/api/public/shares/")) {
      publicRequests.push(req.url());
      expect(req.headers().authorization).toBeUndefined();
    }
  });
  await reader.goto(new URL(link.path, page.url()).href);
  await expect(
    reader.getByRole("heading", { name: "分享目录根", exact: true }),
  ).toBeVisible();
  await expect(reader.locator(".document-prose > p").first()).toContainText(
    "在线正文第 0 段",
  );
  await expect(
    reader.getByText("在线正文第 32 段", { exact: true }),
  ).toHaveCount(0);
  await reader
    .getByRole("button", { name: "继续阅读（已加载 32/80 段）", exact: true })
    .click();
  await expect(
    reader.getByText("在线正文第 32 段", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "三级目录文档", exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "范围外文档", exact: true }),
  ).toHaveCount(0);
  await expect(
    reader.getByRole("link", { name: "正文内前往子文档", exact: true }),
  ).toHaveAttribute("href", `${webOrigin}/share/${link.token}/${child.id}`);
  await expect(
    reader.getByRole("link", { name: "正文中范围外引用", exact: true }),
  ).toHaveCount(0);
  await reader
    .getByRole("link", { name: "正文内前往子文档", exact: true })
    .click();
  await expect(reader).toHaveURL(
    new RegExp(`/share/${link.token}/${child.id}$`),
  );
  await expect(
    reader.getByText("创建链接时的当前正文", { exact: true }),
  ).toBeVisible();
  await reader.goto(new URL(link.path, page.url()).href);
  await reader
    .getByRole("link", { name: "正文内前往三级文档", exact: true })
    .click();
  await expect(reader).toHaveURL(
    new RegExp(`/share/${link.token}/${nested.id}$`),
  );
  await expect(reader.getByText("三级正文", { exact: true })).toBeVisible();
  await reader.goto(new URL(link.path, page.url()).href);
  await reader.getByRole("link", { name: "下级在线文档", exact: true }).click();
  await expect(
    reader.getByText("创建链接时的当前正文", { exact: true }),
  ).toBeVisible();
  await save(child.id, [
    paragraph("child-current", "分享后立即同步的最新正文"),
  ]);
  await reader
    .getByRole("button", { name: "刷新目录与正文", exact: true })
    .click();
  await expect(
    reader.getByText("分享后立即同步的最新正文", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByText("创建链接时的当前正文", { exact: true }),
  ).toHaveCount(0);
  const image = await request.post("/api/files", {
    headers,
    multipart: {
      file: {
        name: "shared.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAF0lEQVR4nGNUW9PJQAgwEVQxqmgAggAAbWUBcxRSQZwAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  expect(image.status()).toBe(201);
  const asset = (await image.json()).data;
  await save(child.id, [
    paragraph("child-current", "分享后立即同步的最新正文"),
    {
      id: "shared-image",
      type: "image",
      props: { url: `orbis-file:${asset.id}`, name: "分享图片" },
      content: [],
      children: [],
    },
  ]);
  await reader
    .getByRole("button", { name: "刷新目录与正文", exact: true })
    .click();
  await expect(
    reader.getByRole("img", { name: "分享图片", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.get(
        `/api/public/shares/${link.token}/notes/${privateNote.id}/files/${asset.id}`,
      )
    ).status(),
  ).toBe(404);
  const future = await createNote("未来新增后代", child.id);
  await reader
    .getByRole("button", { name: "刷新目录与正文", exact: true })
    .click();
  await expect(
    reader.getByRole("link", { name: "未来新增后代", exact: true }),
  ).toBeVisible();
  expect(
    (
      await request.get(
        `/api/public/shares/${link.token}/notes/${privateNote.id}/content`,
      )
    ).status(),
  ).toBe(404);
  const moved = await request.patch(`/api/notes/${child.id}`, {
    headers,
    data: { parent_id: privateNote.id },
  });
  expect(moved.status()).toBe(200);
  await reader
    .getByRole("button", { name: "刷新目录与正文", exact: true })
    .click();
  await expect(
    reader.getByRole("heading", {
      name: "分享已失效或文档不可访问",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    reader.getByText("分享后立即同步的最新正文", { exact: true }),
  ).toHaveCount(0);
  await expect(
    reader.getByRole("link", { name: "未来新增后代", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await request.get(
        `/api/public/shares/${link.token}/notes/${future.id}/content`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.get(
        `/api/public/shares/${link.token}/notes/${child.id}/files/${asset.id}`,
      )
    ).status(),
  ).toBe(404);

  await page.goto(`/collections/${book.id}`);
  await page.getByRole("button", { name: "分享", exact: true }).click();
  const notebookSharing = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/shares") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建公开链接", exact: true }).click();
  const notebookLink = (await (await notebookSharing).json()).data;
  expect(notebookLink.root_note_id).toBeNull();
  expect(notebookLink.id).not.toBe(link.id);
  await reader.goto(new URL(notebookLink.path, page.url()).href);
  await expect(
    reader.getByRole("link", { name: "范围外文档", exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "未来新增后代", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销链接", exact: true }).click();
  await reader
    .getByRole("button", { name: "刷新目录与正文", exact: true })
    .click();
  await expect(
    reader.getByRole("heading", {
      name: "分享已失效或文档不可访问",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await request.get(`/api/public/shares/${notebookLink.token}`)).status(),
  ).toBe(404);
  expect((await request.get("/api/sites", { headers })).status()).toBe(200);
  expect(publicRequests.length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
  expect(privateMetadataRequests).toEqual([]);
  await anonymous.close();
});
