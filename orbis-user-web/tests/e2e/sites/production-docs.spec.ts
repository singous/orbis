import { expect, test } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || "9311"}`;
const webOrigin = `http://127.0.0.1:${process.env.ORBIS_E2E_WEB_PORT || "9310"}`;

test("built documentation serves readable HTML, deep paths, versioned exports and progressive reading", async ({ browser, request }, testInfo) => {
  const credentials = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  let auth = await request.post(`${apiOrigin}/setup`, { data: { ...credentials, display_name: "文档生产构建验证" } });
  if (auth.status() === 409) auth = await request.post(`${apiOrigin}/auth/login`, { data: credentials });
  expect(auth.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await auth.json()).data.access_token}` };
  async function create(path: string, data: unknown) {
    const result = await request.post(`${apiOrigin}${path}`, { headers, data });
    expect(result.ok()).toBe(true);
    return (await result.json()).data;
  }
  const notebook = await create("/notebooks", { title: "生产文档验证" });
  const first = await create("/notes", { notebook_id: notebook.id, title: "指南 & <说明>", sort_order: 0 });
  const second = await create("/notes", { notebook_id: notebook.id, title: "安装指南", sort_order: 1 });
  const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });
  const code = '</script><img src=x onerror="window.__orbisInjected=true">';
  const saved = await request.put(`${apiOrigin}/notes/${first.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: "blocknote", blocks: [paragraph("body", "文档正文直接包含在 HTTP 响应中。"), { id: "sample", type: "codeBlock", props: { language: "html" }, content: code, children: [] }] } } });
  expect(saved.ok()).toBe(true);
  expect((await request.put(`${apiOrigin}/notes/${second.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: "blocknote", blocks: [paragraph("second", "这是独立按需读取的安装正文。")]} } })).ok()).toBe(true);
  const config = { name: "生产文档", slug: "production-docs", description: "一份公开文档，多种读取方式。", navigation: [], source: { kind: "notebooks", notebooks: [{ notebook_id: notebook.id }], excluded_note_ids: [], page_overrides: [{ note_id: first.id, slug: "guides/start" }, { note_id: second.id, slug: "guides/install" }] } };
  const site = await create("/sites", config);
  async function publish() {
    const preview = await request.get(`${apiOrigin}/sites/${site.id}/preview`, { headers });
    expect(preview.ok()).toBe(true);
    return create(`/sites/${site.id}/publish`, { expected_source_fingerprint: (await preview.json()).data.source_fingerprint });
  }
  const release = await publish();
  const startUrl = `${webOrigin}/s/production-docs/guides/start`;
  const raw = await request.get(startUrl);
  expect(raw.status()).toBe(200);
  expect(raw.headers()["content-type"]).toContain("text/html");
  expect(raw.headers()["cache-control"]).toContain("no-store");
  const html = await raw.text();
  expect(html).toContain("文档正文直接包含在 HTTP 响应中。");
  expect(html).toContain("指南 &amp; &lt;说明&gt;");
  expect(html).toContain(`href="${startUrl}"`);
  expect(html).not.toContain(`<img src=x onerror=`);
  expect(html).not.toContain(first.id);
  const bootstrap = JSON.parse(html.match(/<script id="orbis-site-bootstrap" type="application\/json">([\s\S]*?)<\/script>/)![1]);
  expect(bootstrap.manifest.pages.every((page: Record<string, unknown>) => !("blocks" in page) && !("plain_text" in page))).toBe(true);
  expect(bootstrap.page.page.slug).toBe("guides/start");
  expect(bootstrap.page.release_id).toBe(release.release_id);
  const encodedOldPath = await request.get(`${webOrigin}/s/production-docs/guides%2Fstart`);
  expect(encodedOldPath.status()).toBe(200);
  expect((await request.get(`${webOrigin}/s/production-docs/missing/page`)).status()).toBe(404);

  const plainContext = await browser.newContext({ javaScriptEnabled: false });
  const plain = await plainContext.newPage();
  await plain.goto(startUrl);
  await expect(plain.getByRole("heading", { name: "指南 & <说明>", level: 1 })).toBeVisible();
  await expect(plain.getByText("文档正文直接包含在 HTTP 响应中。", { exact: true })).toBeVisible();
  await plain.getByRole("navigation", { name: "站点导航", exact: true }).getByRole("link", { name: "安装指南", exact: true }).click();
  await expect(plain.getByText("这是独立按需读取的安装正文。", { exact: true })).toBeVisible();
  await plain.screenshot({ path: testInfo.outputPath("reader-without-javascript.png"), fullPage: true });
  await plainContext.close();

  const interactive = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await interactive.newPage();
  const errors: string[] = [];
  const requested: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => requested.push(new URL(req.url()).pathname));
  await page.goto(startUrl);
  await expect(page.locator("#orbis-site-bootstrap")).toHaveCount(0);
  await expect(page.getByText("文档正文直接包含在 HTTP 响应中。", { exact: true })).toBeVisible();
  expect(requested).not.toContain("/api/public/sites/production-docs");
  expect(requested).not.toContain("/api/public/sites/production-docs/pages/guides/install");
  expect(requested).not.toContain("/api/public/sites/production-docs/search");
  expect(await page.evaluate(() => Reflect.has(window, "__orbisInjected"))).toBe(false);
  await page.getByRole("button", { name: "复制页面", exact: true }).click();
  await expect(page.getByRole("button", { name: "页面 Markdown 已复制", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("文档正文直接包含在 HTTP 响应中。");
  await page.getByRole("button", { name: "搜索文档", exact: true }).click();
  await page.getByRole("combobox", { name: "搜索文档", exact: true }).fill("独立按需读取");
  await page.getByRole("option", { name: /安装指南/ }).click();
  await expect(page).toHaveURL(`${webOrigin}/s/production-docs/guides/install`);
  await expect(page.getByText("这是独立按需读取的安装正文。", { exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${webOrigin}/s/production-docs/guides/install`);
  await page.screenshot({ path: testInfo.outputPath("production-reader.png"), fullPage: true });
  expect(errors).toEqual([]);
  await interactive.close();

  for (const [path, expected] of [["sitemap.xml", "/s/production-docs/guides/install"], ["llms.txt", "guides/start.md"], ["llms-full.txt", "这是独立按需读取的安装正文。"], ["pages/guides/start.md", "文档正文直接包含在 HTTP 响应中。"], ["robots.txt", "Sitemap:"]] as const) {
    const exported = await request.get(`${webOrigin}/s/production-docs/${path}`);
    expect(exported.status()).toBe(200);
    expect(await exported.text()).toContain(expected);
  }
  const changed = await request.put(`${apiOrigin}/sites/${site.id}`, { headers, data: { ...config, expected_version: site.config_version, source: { ...config.source, page_overrides: [{ note_id: first.id, slug: "guides/welcome" }, { note_id: second.id, slug: "guides/install" }] } } });
  expect(changed.ok()).toBe(true);
  await publish();
  const redirected = await request.get(startUrl, { maxRedirects: 0 });
  expect(redirected.status()).toBe(307);
  expect(redirected.headers().location).toContain("/s/production-docs/guides/welcome");
  expect((await request.get(`${apiOrigin}/public/sites/production-docs/pages/guides/welcome?expected_release_id=${release.release_id}`)).status()).toBe(409);
  await create(`/sites/${site.id}/unpublish`, {});
  for (const path of ["guides/welcome", "sitemap.xml", "robots.txt", "llms.txt", "llms-full.txt", "pages/guides/welcome.md"]) {
    expect((await request.get(`${webOrigin}/s/production-docs/${path}`)).status()).toBe(404);
  }
});
