import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installSession } from "../fixtures/session";
import { installHomeFixture, user } from "../fixtures/home";
import { documentEditorHTTP, documentId } from "../fixtures/document-editor";
import { readerHTTP, siteId } from "../fixtures/site-reader";
import { boardHTTP, collectionId, documentId as boardDocumentId, board } from "../fixtures/board";
import { initialSheet, sheetReadData } from "../fixtures/sheet-workspace";

const RUNTIME_ASSET_TYPES = new Set(["script", "stylesheet", "font", "image"]);
const production = process.env.ORBIS_UI_PRODUCTION === "1";
const manifest: Record<string, { file: string }> | undefined = production
  ? JSON.parse(readFileSync(new URL("../../../dist/.vite/manifest.json", import.meta.url), "utf8"))
  : undefined;

type RuntimeSurface = {
  name: string;
  path: string;
  entry: string;
  setup?: (page: Page, baseURL: string | undefined) => Promise<unknown>;
  verify: (page: Page) => Promise<void>;
};

async function installBoardFixture(page: Page) {
  await installSession(page);
  return boardHTTP(page);
}

const surfaces: RuntimeSurface[] = [
  { name: "login", path: "/login", entry: "index.html", verify: async page => {
    await expect(page.getByRole("textbox", { name: "邮箱", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录 Orbis", exact: true })).toBeVisible();
  } },
  { name: "home", path: "/home", entry: "src/features/home/HomePage.tsx", setup: installHomeFixture, verify: async page => {
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "快速记录", exact: true }).getByRole("textbox", { name: "随手记正文", exact: true })).toBeVisible();
  } },
  { name: "account", path: "/settings/account", entry: "src/features/account/AccountSettingsPage.tsx", setup: installHomeFixture, verify: async page => {
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue(user.display_name);
  } },
  { name: "document", path: `/documents/${documentId}`, entry: "src/app/DocumentRoute.tsx", setup: async page => {
    await installSession(page);
    return documentEditorHTTP(page);
  }, verify: async page => {
    await expect(page.getByRole("textbox", { name: "文档标题", exact: true })).toHaveValue("界面平台化设计");
    await expect(page.locator(".ProseMirror")).toContainText("这是一份固定的文档内容");
    await expect(page.getByRole("toolbar", { name: "文档格式", exact: true })).toBeVisible();
  } },
  { name: "reader", path: "/s/guide", entry: "src/features/sites/PublicSitePage.tsx", setup: readerHTTP, verify: async page => {
    await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
  } },
  { name: "board", path: `/documents/${boardDocumentId}`, entry: "src/features/boards/BoardEditor.tsx", setup: installBoardFixture, verify: async page => {
    await expect(page.getByRole("application", { name: "画板编辑区域", exact: true })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "画板工具", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "主画布", exact: true })).toBeVisible();
  } },
  { name: "sheet", path: `/documents/${initialSheet.document_id}`, entry: "src/features/sheets/SheetWorkspace.tsx", setup: async page => {
    await installHomeFixture(page);
    const sheet = { ...initialSheet, id: documentId };
    await page.route("**/api/v1/workspaces/*/sheets/**", async route => {
      expect(route.request().method()).toBe("GET");
      const path = new URL(route.request().url()).pathname.replace(`/sheets/${sheet.id}`, `/sheets/${initialSheet.id}`);
      await route.fulfill({ json: { code: "OK", message: "", request_id: "production-sheet", data: sheetReadData(path, sheet) } });
    });
    await page.route(`**/api/v1/workspaces/*/collections/${initialSheet.collection_id}`, async route => {
      await route.fulfill({ json: { code: "OK", message: "", request_id: "production-sheet", data: sheetReadData(new URL(route.request().url()).pathname) } });
    });
    await page.route(`**/api/v1/workspaces/*/documents/${initialSheet.document_id}`, async route => {
      const data = { id: initialSheet.document_id, workspace_id: initialSheet.workspace_id, collection_id: initialSheet.collection_id, sheet_id: sheet.id, parent_id: null, position: 0, title: initialSheet.title, content_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "production-sheet", data } });
    });
  }, verify: async page => {
    await expect(page.locator(".sheet-workspace")).toBeVisible();
    await expect(page.getByRole("tab", { name: "全部记录", exact: true })).toBeVisible();
    await expect(page.getByText("示例记录 1", { exact: true })).toBeVisible();
  } },
  { name: "notes", path: "/documents/quick-notes", entry: "src/features/quick-notes/QuickNotesPage.tsx", setup: installHomeFixture, verify: async page => {
    await expect(page.getByRole("heading", { name: "随手记", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "快速记录", exact: true }).getByRole("textbox", { name: "随手记正文", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "历史记录", exact: true }).getByRole("heading", { name: "记下第一个想法", exact: true })).toBeVisible();
  } },
  { name: "overview", path: "/documents", entry: "src/features/documents/DocumentOverviewPage.tsx", setup: installBoardFixture, verify: async page => {
    await expect(page.getByRole("heading", { name: "在线文档", exact: true })).toBeVisible();
    await expect(page.locator(".notebook-overview").getByRole("link", { name: /设计手册/ })).toBeVisible();
  } },
  { name: "notebook", path: `/collections/${collectionId}`, entry: "src/features/documents/NotebookPage.tsx", setup: installBoardFixture, verify: async page => {
    const notebook = page.getByRole("article", { name: "笔记本首页", exact: true });
    await expect(notebook.getByRole("heading", { name: "设计手册", exact: true })).toBeVisible();
    await expect(notebook.getByRole("link", { name: board.title, exact: true })).toBeVisible();
  } },
  { name: "sites", path: "/sites", entry: "src/features/sites/SitesPage.tsx", setup: installHomeFixture, verify: async page => {
    await expect(page.getByRole("heading", { name: "你的文档站点", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "从第一篇文档开始", exact: true })).toBeVisible();
  } },
  { name: "preview", path: `/sites/${siteId}/preview`, entry: "src/features/sites/SitePreviewPage.tsx", setup: async (page, baseURL) => {
    await installSession(page);
    return readerHTTP(page, baseURL);
  }, verify: async page => {
    await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
    await expect(page.locator(".site-reader-preview-banner")).toHaveText("发布预览 · 此页面只有工作空间成员可见");
  } },
  { name: "share", path: `/share/${"a".repeat(43)}`, entry: "src/features/sharing/PublicSharePage.tsx", setup: async page => {
    const document = { id: documentId, title: "公开根文档", content_version: 2, updated_at_ms: 1 };
    const blockId = "00000000-0000-4000-8000-000000000003";
    await page.route("**/api/v1/public/shares/**", async route => {
      expect(route.request().method()).toBe("GET");
      const path = new URL(route.request().url()).pathname;
      const data = path.endsWith("/directory")
        ? { title: "实时团队资料", root_document_id: documentId, directory_version: 7, items: [{ ...document, parent_id: null, position: 0 }], pagination: { page: 1, page_size: 20, total: 1 } }
        : path.endsWith("/children")
          ? { document, items: [{ id: blockId, parent_id: null, position: 0, block_type: "paragraph", child_count: 0, payload_loaded: true, payload_bytes: 32, block: { id: blockId, type: "paragraph", props: {}, content: [{ text: "当前公开正文", marks: [], href: null }], children: [] } }], pagination: { next_cursor: null, has_more: false } }
          : document;
      await route.fulfill({ json: { code: "OK", message: "", request_id: "production-share", data } });
    });
  }, verify: async page => {
    await expect(page.getByRole("heading", { name: "公开根文档", exact: true })).toBeVisible();
    await expect(page.getByText("当前公开正文", { exact: true })).toBeVisible();
  } },
  { name: "public form", path: "/forms/form-token", entry: "src/features/sheets/PublicSheetForm.tsx", setup: async page => {
    await page.route("**/api/v1/public/forms/form-token", async route => {
      expect(route.request().method()).toBe("GET");
      const data = { id: "form-1", version: 4, config: { title: "活动报名", description: "请填写报名资料", fields: [{ field_id: "name", required: true, description: "请输入姓名" }] }, fields: [{ id: "name", name: "姓名", kind: "text", options: [], default: null }] };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "production-public-form", data } });
    });
  }, verify: async page => {
    await expect(page.getByRole("heading", { name: "活动报名", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "姓名", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "提交", exact: true })).toBeEnabled();
  } },
];

for (const { name: surface, path, entry, setup, verify } of surfaces) test(`${surface} loads runtime assets from its own origin`, async ({ page, baseURL }, testInfo) => {
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

  await setup?.(page, baseURL);
  await page.goto(path);
  await verify(page);

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
  const entryAsset = manifest?.[entry]?.file;
  const entryResponses = entryAsset ? responses.filter(response => new URL(response.url).pathname === `/${entryAsset}`) : [];
  const external = requests.filter(request => new URL(request.url).origin !== origin);
  const evidence = { mode: production ? "production" : "development", surface, path, origin, entry, entryAsset, entryResponses, requests, responses, external, failures, rendered };
  await testInfo.attach("runtime-network", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  console.log(JSON.stringify({ surface, mode: evidence.mode, origin, assets: requests.length, types: Object.fromEntries([...RUNTIME_ASSET_TYPES].map(type => [type, requests.filter(request => request.type === type).length])), entry, entryAsset, entryStatuses: entryResponses.map(response => response.status), external: external.length, failures: failures.length, entryScripts: rendered.entryScripts }));

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
  if (production) {
    for (const script of rendered.entryScripts) expect(new URL(script).pathname).toMatch(/^\/assets\/[^/]+-[\w-]{8,}\.js$/);
    expect(entryAsset, `The production manifest must contain ${entry}`).toBeTruthy();
    expect(entryResponses.some(response => response.type === "script" && response.status === 200), `${entry} must actually load its compiled asset`).toBe(true);
  }
});
