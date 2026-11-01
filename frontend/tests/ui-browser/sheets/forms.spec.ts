import { expect, test, type Page } from "@playwright/test";

const fields = [
  { id: "name", name: "姓名", kind: "text", options: [], default: null },
  { id: "status", name: "状态", kind: "select", options: [{ id: "open", label: "进行中", color: "green" }, { id: "done", label: "已完成", color: "blue" }], default: null },
  { id: "extra", name: "备注", kind: "text", options: [], default: null },
];
const form = { id: "form-1", sheet_id: "sheet-1", version: 4, enabled: true, token: "form-token", config: { title: "活动报名", description: "请填写报名资料", fields: [{ field_id: "name", required: true, description: "请输入姓名" }, { field_id: "status", required: false, description: "" }] } };

async function mountForm(page: Page, mode: "editor" | "public") {
  await page.goto("/__ui");
  await page.evaluate(async ({ mode, form, fields }) => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const editorSource = await (await fetch("/src/features/sheets/SheetForms.tsx")).text();
    const publicSource = await (await fetch("/src/features/sheets/PublicSheetForm.tsx")).text();
    const routerURL = editorSource.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const queryURL = publicSource.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, router, query, editor, publicForm, api] = await Promise.all([
      import(reactURL), import(domURL), import(routerURL), import(queryURL), import("/src/features/sheets/SheetForms.tsx"), import("/src/features/sheets/PublicSheetForm.tsx"), import("/src/features/sheets/api.ts"),
    ]);
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.dataset.testid = "forms-preview";
    document.body.append(host);
    const auth = { accessToken: "forms-ui", refreshToken: null, workspaceId: "00000000-0000-4000-8000-000000000001", onTokenRefresh: () => {}, onUnauthorized: () => {} };
    function Editor() {
      const [current, setCurrent] = React.useState(form);
      const controller = { auth, api: api.sheetAPI(auth), meta: { data: { id: "sheet-1", definition: { fields, views: [] } } }, forms: { refetch: async () => { const all = await api.sheetAPI(auth).forms("sheet-1"); setCurrent(all[0]); } }, update: async () => { throw new Error("This journey must not change the sheet schema"); } };
      return React.createElement("div", { className: "sheet-workspace", style: { height: "900px", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" } }, React.createElement(editor.SheetForms, { controller, form: current, fields, readOnly: false }));
    }
    const dataRouter = router.createMemoryRouter([{ path: "/forms/:token", element: mode === "editor" ? React.createElement(Editor) : React.createElement(publicForm.PublicSheetForm) }], { initialEntries: ["/forms/form-token"] });
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(router.RouterProvider, { router: dataRouter })));
  }, { mode, form, fields });
}

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test(`sheet forms preserve editing, public retry and layout in ${theme} at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  const saves: typeof form[] = [], submissions: Array<{ operation_id: string; version: number; values: Record<string, unknown> }> = [];
  let saved = structuredClone(form);
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let data: unknown;
    if (path.endsWith("/submissions")) {
      submissions.push(request.postDataJSON());
      if (submissions.length === 1) {
        await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "请重试原提交", request_id: "forms-ui", data: null } });
        return;
      }
      data = { id: "record-1" };
    } else if (path.endsWith("/forms") && request.method() === "PUT") {
      saves.push(request.postDataJSON());
      saved = { ...request.postDataJSON(), version: 5 };
      data = saved;
    } else if (path.endsWith("/forms")) data = { items: [saved] };
    else data = { id: form.id, version: form.version, config: form.config, fields };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "forms-ui", data } });
  });
  await mountForm(page, "editor");
  const title = page.getByRole("textbox", { name: "表单标题", exact: true });
  await expect(title).toHaveCSS("font-size", "18px");
  await expect(title).toHaveCSS("box-shadow", "none");
  await expect(page.getByRole("button", { name: "编辑表单", exact: true })).toHaveCSS("font-size", "12px");
  await expect(page.getByRole("button", { name: "文本", exact: true })).toHaveCSS("font-size", "12px");
  await expect(page.locator(".sheet-form-paper")).toHaveCSS("padding", width === 1280 ? "32px" : "24px");
  await title.fill("更新后的报名");
  await page.getByRole("button", { name: "下移问题", exact: true }).first().click();
  await page.getByRole("button", { name: "保存表单", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]).toMatchObject({ version: 4, enabled: true, config: { title: "更新后的报名", fields: [{ field_id: "status", required: false }, { field_id: "name", required: true }] } });
  await page.getByRole("button", { name: "分享表单", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "收集表单", exact: true });
  await expect(dialog.getByRole("img", { name: "表单填写二维码" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "填写链接" })).toHaveValue(/\/forms\/form-token$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "分享表单", exact: true })).toBeFocused();
  await mountForm(page, "public");
  await expect(page.getByRole("heading", { name: "活动报名", exact: true })).toBeVisible();
  await expect(page.locator(".sheet-form-paper")).toHaveCSS("padding", width === 1280 ? "40px" : "24px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("textbox", { name: "姓名", exact: true }).fill("报名成员");
  await page.getByRole("radio", { name: "进行中", exact: true }).check();
  const submit = page.getByRole("button", { name: "提交", exact: true });
  await expect(submit).toHaveCSS("min-height", width === 1280 ? "32px" : "44px");
  await submit.click();
  const retry = page.getByRole("button", { name: "重试提交", exact: true });
  await expect(retry).toBeEnabled();
  await page.getByRole("textbox", { name: "姓名", exact: true }).fill("修改不覆盖原意图");
  await retry.click();
  await expect(page.getByRole("heading", { name: "提交成功", exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0]).toMatchObject({ version: 4, values: { name: "报名成员", status: "open" } });
  expect(submissions[0].operation_id).toBeTruthy();
});
