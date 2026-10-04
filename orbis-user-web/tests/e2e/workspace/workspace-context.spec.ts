import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

const credentials = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
type ContextWorkspace = { id: string; name: string };
type ContextNote = { id: string; title: string };

// There is no workspace-creation API. Seed only this suite's temporary database;
// discovery, switching, authorization and all resource operations use real HTTP.
const seedWorkspace = String.raw`
import asyncio, json, sys
from pathlib import Path
from uuid import UUID
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
sys.path.insert(0, str(Path.cwd().parent / 'orbis-user-api' / 'src'))
from orbis_user_api.core.ids import new_uuidv7
from orbis_user_api.models.user import User
from orbis_user_api.models.workspace import Workspace, WorkspaceMember
from orbis_user_api.models.note import NoteGroup
runtime = Path(sys.argv[1]).resolve()
assert runtime.is_dir() and runtime.name.startswith('orbis-e2e-'), 'Only isolated E2E databases may be seeded'
assert (runtime / 'app.db').is_file()
async def seed():
    engine = create_async_engine(f'sqlite+aiosqlite:///{runtime / "app.db"}')
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            owner_id = UUID(sys.argv[2])
            assert await session.get(User, owner_id) is not None
            workspace = Workspace(id=new_uuidv7(), owner_id=owner_id, name=sys.argv[3], workspace_type='team')
            session.add_all([workspace,
                WorkspaceMember(id=new_uuidv7(), workspace_id=workspace.id, user_id=owner_id, role='owner'),
                NoteGroup(id=new_uuidv7(), workspace_id=workspace.id, owner_id=owner_id, name='默认分组', is_default=True)])
            await session.commit()
            print(json.dumps({'id': str(workspace.id), 'name': workspace.name}))
    finally:
        await engine.dispose()
asyncio.run(seed())
`;

async function prepareContexts(page: Page, request: APIRequestContext, surface: "web" | "desktop" = "web") {
  if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  const setup = await request.post("/api/setup", { data: { ...credentials, display_name: "空间上下文验收" } });
  expect([201, 409]).toContain(setup.status());
  const login = await request.post("/api/auth/login", { data: credentials });
  expect(login.status()).toBe(200);
  const auth = (await login.json()).data;
  const source: ContextWorkspace = auth.workspace;
  const marker = `context-${Date.now()}`;
  const target = JSON.parse(execFileSync(resolve("../.venv/bin/python"), ["-c", seedWorkspace, process.env.ORBIS_E2E_DIR!, auth.user.id, `${marker}第二空间`], { encoding: "utf8" })) as ContextWorkspace;
  const tokenHeaders = { Authorization: `Bearer ${auth.access_token}` };
  const headers = (workspace: ContextWorkspace) => ({ ...tokenHeaders, "X-Workspace-ID": workspace.id });
  const notes: ContextNote[] = [];
  for (const [index, workspace] of [source, target].entries()) {
    const notebook = await request.post("/api/notebooks", { headers: headers(workspace), data: { title: `${marker}-${index}笔记本` } });
    expect(notebook.status()).toBe(201);
    const note = await request.post("/api/notes", { headers: headers(workspace), data: { notebook_id: (await notebook.json()).data.id, title: `${marker}-${index}文档` } });
    expect(note.status()).toBe(201);
    notes.push((await note.json()).data);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  return { source, target, notes, marker, tokenHeaders, headers };
}

const selectedWorkspace = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).workspace.id as string);
const globalRequestPaths = new Set(["/api/workspaces", "/api/workspace/switch"]);
const isContextualPath = (path: string) => /^\/api\/(?:search|notes|notebooks|document-groups|sites|files)(?:\/|$)/.test(path);

async function openWorkspaceMenu(page: Page) {
  await page.getByRole("button", { name: "切换工作空间", exact: true }).click();
  const menu = page.locator(".workspace-switcher-popover");
  await expect(menu).toBeVisible();
  return menu;
}

async function expectCurrentSearch(page: Page, marker: string, note: ContextNote, workspaceName: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await palette.getByRole("combobox", { name: "搜索任何内容", exact: true }).fill(`@doc ${marker}`);
  await expect(palette.locator("[data-search-result]")).toHaveCount(1);
  await expect(palette.locator("[data-search-result]")).toContainText(note.title);
  await expect(palette.getByRole("button", { name: "搜索范围" })).toHaveCount(0);
  await expect(palette.getByRole("combobox", { name: "搜索范围" })).toHaveCount(0);
  await expect(palette.locator("[data-search-result]")).not.toContainText(workspaceName);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
}

for (const surface of ["web", "desktop"] as const) {
  test(`${surface} selects one global workspace and every feature search uses that explicit context`, async ({ page, request }) => {
    const fixture = await prepareContexts(page, request, surface);
    const requests: { path: string; workspace: string | undefined; url: string }[] = [];
    page.on("request", outgoing => {
      const path = new URL(outgoing.url()).pathname;
      if (isContextualPath(path) || globalRequestPaths.has(path)) requests.push({ path, workspace: outgoing.headers()["x-workspace-id"], url: outgoing.url() });
    });
    try {
      await page.goto("/home");
      await expect(page.locator(".workspace-content")).not.toContainText(fixture.source.name);
      await expectCurrentSearch(page, fixture.marker, fixture.notes[0], fixture.source.name);
      expect(requests.filter(item => isContextualPath(item.path)).length).toBeGreaterThan(0);
      for (const outgoing of requests.filter(item => isContextualPath(item.path))) expect(outgoing.workspace).toBe(fixture.source.id);
      for (const outgoing of requests.filter(item => item.path === "/api/search")) {
        expect(new URL(outgoing.url).searchParams.has("scope")).toBe(false);
        expect(new URL(outgoing.url).searchParams.has("workspace_id")).toBe(false);
      }
      await page.setViewportSize({ width: 320, height: 480 });
      if (surface === "web") await page.getByRole("button", { name: "打开主导航", exact: true }).click();
      const menu = await openWorkspaceMenu(page);
      await expect(menu.getByText(fixture.target.name, { exact: true })).toBeVisible();
      const geometry = await menu.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const list = element.querySelector<HTMLElement>(".workspace-switcher-list")!;
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: list.clientWidth, scrollWidth: list.scrollWidth };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(320);
      expect(geometry.bottom).toBeLessThanOrEqual(480);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      await menu.getByText(fixture.target.name, { exact: true }).click();
      await expect.poll(() => selectedWorkspace(page)).toBe(fixture.target.id);
      await expect(menu).toHaveCount(0);
      const globalRequests = requests.filter(item => globalRequestPaths.has(item.path));
      expect(globalRequests.some(item => item.path === "/api/workspaces")).toBe(true);
      expect(globalRequests.some(item => item.path === "/api/workspace/switch")).toBe(true);
      for (const outgoing of globalRequests) expect(outgoing.workspace).toBeUndefined();

      requests.length = 0;
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/home");
      await expect(page.locator(".workspace-content")).not.toContainText(fixture.target.name);
      await expectCurrentSearch(page, fixture.marker, fixture.notes[1], fixture.target.name);
      for (const outgoing of requests.filter(item => isContextualPath(item.path))) expect(outgoing.workspace).toBe(fixture.target.id);
      const sourceRead = await request.get(`/api/notes/${fixture.notes[0].id}`, { headers: fixture.headers(fixture.source) });
      expect(sourceRead.status()).toBe(200);
      expect((await request.get(`/api/notes/${fixture.notes[0].id}`, { headers: fixture.headers(fixture.target) })).status()).toBe(404);
      const search = await request.get(`/api/search?q=${fixture.marker}&type=document&scope=all&workspace_id=${fixture.source.id}`, { headers: fixture.headers(fixture.target) });
      expect(search.status()).toBe(200);
      expect((await search.json()).data.items.map((item: { id: string }) => item.id)).toEqual([fixture.notes[1].id]);
    } finally {
      expect((await request.post("/api/workspace/switch", { headers: fixture.tokenHeaders, data: { workspace_id: fixture.source.id } })).status()).toBe(200);
    }
  });
}

test("legacy search ranges and cross-workspace result URLs cannot change the global selection", async ({ page, request }) => {
  const fixture = await prepareContexts(page, request);
  let switches = 0;
  page.on("request", outgoing => { if (new URL(outgoing.url()).pathname === "/api/workspace/switch") switches += 1; });
  await page.goto(`/search?q=${fixture.marker}&type=document&scope=all&workspace_id=${fixture.target.id}`);
  await expect(page.locator(".global-search-result")).toHaveCount(1);
  await expect(page.locator(".global-search-result")).toContainText(fixture.notes[0].title);
  await expect(page.getByRole("button", { name: /搜索范围/ })).toHaveCount(0);
  await expect(page.locator(".global-search-result")).not.toContainText(fixture.source.name);
  await page.goto(`/search/open?type=document&id=${fixture.notes[1].id}&workspace_id=${fixture.target.id}&status=active`);
  await expect(page.getByRole("status").filter({ hasText: "无法打开内容" })).toContainText(/空间菜单|切换/);
  expect(await selectedWorkspace(page)).toBe(fixture.source.id);
  expect(switches).toBe(0);
});

for (const outcome of ["saved", "conflict"] as const) {
  test(`global workspace switching ${outcome === "saved" ? "awaits the active draft save" : "keeps the draft and selection after a save conflict"}`, async ({ page, request }) => {
    const fixture = await prepareContexts(page, request);
    await page.goto(`/documents/${fixture.notes[0].id}`);
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    let releaseSave!: () => void;
    let saveStarted = false;
    let switches = 0;
    const gate = new Promise<void>(resolve => { releaseSave = resolve; });
    page.on("request", outgoing => { if (new URL(outgoing.url()).pathname === "/api/workspace/switch") switches += 1; });
    await page.route(`**/api/notes/${fixture.notes[0].id}/{content,blocks}`, async route => {
      if (!["PUT", "PATCH"].includes(route.request().method())) { await route.continue(); return; }
      expect(route.request().headers()["x-workspace-id"]).toBe(fixture.source.id);
      saveStarted = true;
      await gate;
      if (outcome === "conflict") await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "NOTE_VERSION_CONFLICT", message: "正文版本冲突", request_id: "workspace-switch-conflict", data: null }) });
      else await route.continue();
    });
    const marker = `切换之前必须保存-${outcome}`;
    try {
      await editor.locator("p").first().click();
      await page.keyboard.insertText(marker);
      const menu = await openWorkspaceMenu(page);
      await menu.getByText(fixture.target.name, { exact: true }).click();
      await expect.poll(() => saveStarted).toBe(true);
      expect(switches).toBe(0);
      expect(await selectedWorkspace(page)).toBe(fixture.source.id);
      await expect(editor).toContainText(marker);
      releaseSave();
      if (outcome === "saved") {
        await expect.poll(() => selectedWorkspace(page)).toBe(fixture.target.id);
        expect(switches).toBe(1);
        const persisted = await request.get(`/api/notes/${fixture.notes[0].id}/content`, { headers: fixture.headers(fixture.source) });
        expect(persisted.status()).toBe(200);
        expect((await persisted.json()).data.plain_text).toContain(marker);
      } else {
        await expect(menu.getByRole("alert")).toContainText(/草稿|冲突|保存/);
        expect(switches).toBe(0);
        expect(await selectedWorkspace(page)).toBe(fixture.source.id);
        await expect(page).toHaveURL(new RegExp(`/documents/${fixture.notes[0].id}$`));
        await expect(editor).toContainText(marker);
      }
    } finally {
      releaseSave();
      expect((await request.post("/api/workspace/switch", { headers: fixture.tokenHeaders, data: { workspace_id: fixture.source.id } })).status()).toBe(200);
    }
  });
}
