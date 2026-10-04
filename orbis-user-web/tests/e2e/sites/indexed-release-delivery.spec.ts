import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });
const credentials = {
  email: "owner@example.com",
  password: "Orbis-browser-test-2026!",
};
const paragraph = (id: string, text: string) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text }],
  children: [],
});

test("an indexed site delivers one frozen page and preserves explicit publish rollback and withdrawal", async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect([201, 409]).toContain(
    (
      await request.post("/api/setup", {
        data: { ...credentials, display_name: "Indexed site acceptance" },
      })
    ).status(),
  );
  const login = (
    await (await request.post("/api/auth/login", { data: credentials })).json()
  ).data;
  const headers = {
    Authorization: `Bearer ${login.access_token}`,
    "X-Workspace-ID": login.workspace.id,
  };
  const notebook = (
    await (
      await request.post("/api/notebooks", {
        headers,
        data: { title: "Indexed site sources" },
      })
    ).json()
  ).data;
  async function note(title: string) {
    const response = await request.post("/api/notes", {
      headers,
      data: { notebook_id: notebook.id, title },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  }
  async function save(noteId: string, blocks: unknown[]) {
    const current = (
      await (
        await request.get(`/api/notes/${noteId}/content`, { headers })
      ).json()
    ).data;
    const response = await request.put(`/api/notes/${noteId}/content`, {
      headers,
      data: {
        expected_version: current.content_version,
        blocks: { schema_version: 2, editor: "blocknote", blocks },
      },
    });
    expect(response.status()).toBe(200);
  }
  const firstNote = await note("First indexed page");
  const secondNote = await note("Second indexed page");
  await save(firstNote.id, [
    paragraph("first", "FIRST_RELEASE_BODY"),
    {
      id: "callout",
      type: "callout",
      props: { title: "Native publication component", tone: "info" },
      content: [],
      children: [paragraph("nested", "Frozen nested content")],
    },
  ]);
  await save(secondNote.id, [paragraph("second", "SECOND_PAGE_BODY_ONLY")]);
  const siteResponse = await request.post("/api/sites", {
    headers,
    data: {
      name: "Indexed reader acceptance",
      slug: "indexed-reader-acceptance",
      navigation: [
        {
          note_id: firstNote.id,
          slug: "first",
          title: "First indexed page",
          group: "Docs",
        },
        {
          note_id: secondNote.id,
          slug: "second",
          title: "Second indexed page",
          group: "Docs",
        },
      ],
    },
  });
  expect(siteResponse.status()).toBe(201);
  const site = (await siteResponse.json()).data;
  async function publish() {
    const response = await request.post(`/api/sites/${site.id}/publish`, {
      headers,
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  }
  const firstRelease = await publish();
  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  const deliveryRequests: string[] = [];
  reader.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/api/public/sites/")) deliveryRequests.push(pathname);
  });
  reader.on("pageerror", (error) => errors.push(error.message));
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  const firstUrl = `${origin}/s/indexed-reader-acceptance/first`;
  const response = await reader.goto(firstUrl);
  expect(response?.status()).toBe(200);
  const html = await response!.text();
  expect(html).toContain("FIRST_RELEASE_BODY");
  expect(html).not.toContain("SECOND_PAGE_BODY_ONLY");
  const bootstrap = html.match(/<script[^>]*id="orbis-site-bootstrap"[^>]*>([\s\S]*?)<\/script>/);
  expect(bootstrap).not.toBeNull();
  const initialDelivery = JSON.parse(bootstrap![1]);
  expect(initialDelivery.manifest.pages).toHaveLength(2);
  expect(initialDelivery.manifest.pages.every((item: Record<string, unknown>) => !('blocks' in item) && !('plain_text' in item))).toBe(true);
  await expect(
    reader.getByText("Frozen nested content", { exact: true }),
  ).toBeVisible();
  await expect(
    reader
      .getByRole("link", { name: "Second indexed page", exact: true })
      .first(),
  ).toBeVisible();
  // Bootstrap removal is an effect of the production React reader. A static
  // server-rendered document must not satisfy this JavaScript acceptance gate.
  await expect(reader.locator("#orbis-site-bootstrap")).toHaveCount(0);
  await reader.getByRole("link", { name: "Second indexed page", exact: true }).first().click();
  await expect(reader).toHaveURL(/\/s\/indexed-reader-acceptance\/second$/);
  await expect(reader.getByText("SECOND_PAGE_BODY_ONLY", { exact: true })).toBeVisible();
  await expect.poll(() => deliveryRequests.some(path => path.endsWith("/pages/second"))).toBe(true);
  expect(deliveryRequests).not.toContain("/api/public/sites/indexed-reader-acceptance");
  await reader.getByRole("link", { name: "First indexed page", exact: true }).first().click();
  await expect(reader.getByText("FIRST_RELEASE_BODY", { exact: true })).toBeVisible();
  await save(firstNote.id, [
    paragraph("first", "PRIVATE_EDIT_NOT_YET_PUBLISHED"),
  ]);
  await reader.reload();
  await expect(
    reader.getByText("FIRST_RELEASE_BODY", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByText("PRIVATE_EDIT_NOT_YET_PUBLISHED", { exact: true }),
  ).toHaveCount(0);
  const secondRelease = await publish();
  const stale = await anonymous.request.get(
    `${origin}/api/public/sites/indexed-reader-acceptance/pages/first?expected_release_id=${firstRelease.release_id}`,
  );
  expect(stale.status()).toBe(409);
  await reader.reload();
  await expect(
    reader.getByText("PRIVATE_EDIT_NOT_YET_PUBLISHED", { exact: true }),
  ).toBeVisible();
  const activated = await request.post(
    `/api/sites/${site.id}/releases/${firstRelease.release_id}/activate`,
    { headers },
  );
  expect(activated.status()).toBe(200);
  await reader.reload();
  await expect(
    reader.getByText("FIRST_RELEASE_BODY", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByText("Frozen nested content", { exact: true }),
  ).toBeVisible();
  const removed = await request.post(`/api/sites/${site.id}/unpublish`, {
    headers,
  });
  expect(removed.status()).toBe(200);
  const withdrawn = await reader.reload();
  expect(withdrawn?.status()).toBe(404);
  await expect(
    reader.getByText("FIRST_RELEASE_BODY", { exact: true }),
  ).toHaveCount(0);
  const restored = await request.post(
    `/api/sites/${site.id}/releases/${secondRelease.release_id}/activate`,
    { headers },
  );
  expect(restored.status()).toBe(200);
  await reader.goto(firstUrl);
  await expect(
    reader.getByText("PRIVATE_EDIT_NOT_YET_PUBLISHED", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await anonymous.close();
});
