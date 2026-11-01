import { expect, test } from "@playwright/test";
import { installSession } from "../fixtures/session";
import { installHomeFixture, user } from "../fixtures/home";
import { documentEditorHTTP, documentId } from "../fixtures/document-editor";
import { readerHTTP } from "../fixtures/site-reader";

const RUNTIME_ASSET_TYPES = new Set(["script", "stylesheet", "font", "image"]);
const production = process.env.ORBIS_UI_PRODUCTION === "1";
const routes = { login: "/login", home: "/home", account: "/settings/account", document: `/documents/${documentId}`, reader: "/s/guide" };

for (const [surface, path] of Object.entries(routes)) test(`${surface} loads runtime assets from its own origin`, async ({ page, baseURL }, testInfo) => {
  const requests: Array<{ type: string; url: string }> = [];
  const responses: Array<{ type: string; url: string; status: number }> = [];
  const failures: Array<{ url: string; error: string | undefined }> = [];
  page.on("request", request => {
    if (RUNTIME_ASSET_TYPES.has(request.resourceType())) requests.push({ type: request.resourceType(), url: request.url() });
  });
  page.on("response", response => {
    const type = response.request().resourceType();
    if (RUNTIME_ASSET_TYPES.has(type)) responses.push({ type, url: response.url(), status: response.status() });
  });
  page.on("requestfailed", request => {
    if (RUNTIME_ASSET_TYPES.has(request.resourceType())) failures.push({ url: request.url(), error: request.failure()?.errorText });
  });

  if (surface === "home" || surface === "account") await installHomeFixture(page);
  else if (surface === "document") {
    await installSession(page);
    await documentEditorHTTP(page);
  } else if (surface === "reader") await readerHTTP(page, baseURL);
  await page.goto(path);
  if (surface === "login") {
    await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录 Orbis", exact: true })).toBeVisible();
  } else if (surface === "home") {
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "快速记录", exact: true }).getByRole("textbox", { name: "随手记正文", exact: true })).toBeVisible();
  } else if (surface === "account") await expect(page.getByLabel("名称", { exact: true })).toHaveValue(user.display_name);
  else if (surface === "document") {
    await expect(page.getByRole("textbox", { name: "文档标题", exact: true })).toHaveValue("界面平台化设计");
    await expect(page.locator(".ProseMirror")).toContainText("这是一份固定的文档内容");
    await expect(page.getByRole("toolbar", { name: "文档格式", exact: true })).toBeVisible();
  } else await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();

  const rendered = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter(image => image.getClientRects().length > 0).map(image => image.decode()));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      entryScripts: Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map(script => script.src),
      stylesheets: Array.from(document.styleSheets).map(sheet => sheet.href),
      loadedFonts: Array.from(document.fonts).filter(font => font.status === "loaded").map(font => font.family),
      bodyFont: getComputedStyle(document.body).fontFamily,
    };
  });
  const origin = new URL(path, baseURL).origin;
  const evidence = { mode: production ? "production" : "development", surface, path, origin, requests, responses, failures, rendered };
  await testInfo.attach("runtime-network", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  console.log(JSON.stringify({ surface, mode: evidence.mode, origin, assets: requests.length, types: Object.fromEntries([...RUNTIME_ASSET_TYPES].map(type => [type, requests.filter(request => request.type === type).length])), entryScripts: rendered.entryScripts }));

  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter(request => new URL(request.url).origin !== origin), "Runtime assets must not request an external origin").toEqual([]);
  expect(failures, "Runtime asset downloads must finish successfully").toEqual([]);
  expect(responses.filter(response => response.status >= 400)).toEqual([]);
  expect(responses.filter(response => response.type === "script" && response.status === 200).length).toBeGreaterThan(0);
  expect(responses.filter(response => (response.type === "stylesheet" || new URL(response.url).pathname.endsWith(".css")) && response.status === 200).length).toBeGreaterThan(0);
  expect(responses.filter(response => response.type === "font" && response.status === 200).length).toBeGreaterThan(0);
  expect(rendered.stylesheets.length).toBeGreaterThan(0);
  expect(rendered.loadedFonts).toContain("Inter Variable");
  expect(rendered.bodyFont).toContain("Inter Variable");
  expect(rendered.entryScripts.length).toBeGreaterThan(0);
  if (production) for (const script of rendered.entryScripts) expect(new URL(script).pathname).toMatch(/^\/assets\/[^/]+-[\w-]{8,}\.js$/);
});
