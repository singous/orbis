import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installSession, user, workspace } from "../fixtures/session";

const now = Date.parse("2026-11-01T00:00:00Z");
const tag = { id: "00000000-0000-4000-8000-000000000010", name: "设计", version: 3, count: 1, created_at_ms: 1, updated_at_ms: 1 };
const note = { id: "00000000-0000-4000-8000-000000000011", workspace_id: workspace.id, owner_id: user.id, version: 4, blocks: [{ id: "00000000-0000-4000-8000-000000000012", type: "paragraph", props: {}, content: [{ text: "保留原记录", marks: [], href: null }], children: [] }], tag_ids: [tag.id], is_pinned: true, created_at_ms: now, updated_at_ms: now, deleted_at_ms: null };
const pageData = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });

test.beforeEach(async ({ page }) => {
  await installSession(page);
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = pageData([]);
    if (path.endsWith("/quick-notes/summary")) data = { total: 1, untagged: 0, deleted: 0 };
    else if (path.endsWith("/quick-note-tags")) data = pageData([tag]);
    else if (path.endsWith("/quick-notes")) data = pageData([note]);
    else if (path === "/api/v1/me") data = user;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "quick-notes-ui", data } });
  });
});

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  test(`quick notes ${theme} at ${width}px retains editor and record geometry`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/documents/quick-notes");
    const composer = page.getByRole("region", { name: "快速记录", exact: true });
    const records = page.getByRole("region", { name: "历史记录", exact: true });
    await expect(records.getByRole("article", { name: "随手记记录" })).toHaveCount(1);
    await expect(composer.locator(".tiptap")).toHaveCSS("min-height", width === 1280 ? "320px" : "220px");
    await expect(composer.locator(".tiptap")).toHaveCSS("padding", width === 1280 ? "16px 24px" : "16px");
    await expect(composer.locator(".quick-note-tools button").first()).toHaveCSS("width", "32px");
    await expect(composer).toHaveCSS("position", width === 1280 ? "sticky" : "static");
    await composer.getByRole("button", { name: "插入图片", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(composer.getByRole("button", { name: "待办清单", exact: true })).toBeFocused();
    await expect(records.locator(".quick-note-card")).toHaveCSS("border-radius", "8px");
    expect(await page.locator(".quick-notes-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include(".quick-notes-page").analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "卡片视图", exact: true }).click();
    await expect(page.getByRole("button", { name: "卡片视图", exact: true })).toHaveAttribute("aria-pressed", "true");
    await composer.getByRole("button", { name: "展开编辑区", exact: true }).click();
    await expect(records).toBeHidden();
    await expect(composer.locator(".tiptap")).toHaveCSS("min-height", "520px");
    await expect(composer.locator(".tiptap")).toHaveCSS("max-height", "none");
    await page.keyboard.press("Escape");
    await expect(records).toBeVisible();
    await expect(composer.locator(".tiptap")).toHaveCSS("min-height", width === 1280 ? "320px" : "220px");
    await records.getByRole("button", { name: "编辑记录", exact: true }).click();
    const editing = page.getByRole("dialog", { name: "编辑随手记", exact: true });
    await expect(editing.getByRole("textbox", { name: "随手记正文" })).toHaveText("保留原记录");
    await expect(editing.locator(".quick-note-composer")).toHaveCSS("position", "static");
    await expect(editing.locator(".quick-note-composer-heading")).toBeHidden();
    await editing.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).include(".quick-note-edit-dialog").analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(editing).toBeHidden();
  });
}

test("quick note expansion overrides compact heights at inclusive responsive boundaries", async ({ page }) => {
  await page.goto("/documents/quick-notes");
  const composer = page.getByRole("region", { name: "快速记录", exact: true });
  const editor = composer.getByRole("textbox", { name: "随手记正文", exact: true });
  const records = page.getByRole("region", { name: "历史记录", exact: true });
  await editor.fill("调整宽度和展开时保留草稿");
  for (const width of [1101, 1100, 651, 650, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const minimum = width <= 1100 ? "220px" : "320px";
    const maximum = width <= 1100 ? "420px" : "520px";
    await expect(editor).toHaveCSS("min-height", minimum);
    await expect(editor).toHaveCSS("max-height", maximum);
    await expect(editor).toHaveCSS("padding", width <= 650 ? "16px" : "16px 24px");
    await expect(composer).toHaveCSS("position", width <= 1100 ? "static" : "sticky");
    await expect(page.locator(".quick-notes-page")).toHaveCSS("padding", width <= 650 ? "16px" : "24px");
    await expect(composer.locator(".quick-note-shortcut")).toBeVisible({ visible: width > 650 });
    await expect(page.locator(".quick-notes-heading>div>span").first()).toBeVisible({ visible: width > 650 });
    const columns = await page.locator(".quick-notes-layout").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width <= 1100 ? 1 : 2);
    await composer.getByRole("button", { name: "展开编辑区", exact: true }).click();
    await expect(records).toBeHidden();
    await expect(editor).toHaveCSS("min-height", "520px");
    await expect(editor).toHaveCSS("max-height", "none");
    await page.keyboard.press("Escape");
    await expect(records).toBeVisible();
    await expect(editor).toHaveCSS("min-height", minimum);
    await expect(editor).toHaveCSS("max-height", maximum);
    await expect(editor).toHaveText("调整宽度和展开时保留草稿");
  }
});

test("quick notes preserves a local draft and retries an uncertain keyboard save with the same operation", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/quick-notes", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill(requests.length === 1 ? { status: 503, json: { code: "WRITE_RESULT_UNKNOWN", message: "结果未知，请重试", request_id: "quick-note-retry" } } : { json: { code: "OK", message: "", request_id: "quick-note-saved", data: { ...note, ...body, version: 1 } } });
  });
  await page.goto("/documents/quick-notes");
  const composer = page.getByRole("region", { name: "快速记录", exact: true });
  const editor = composer.getByRole("textbox", { name: "随手记正文" });
  await editor.fill("跨刷新保留的灵感");
  await composer.locator("summary").click();
  await composer.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
  await composer.locator("summary").click();
  await page.reload();
  await expect(editor).toHaveText("跨刷新保留的灵感");
  await expect(composer.locator(".quick-note-selected-tag")).toContainText("设计");
  await editor.dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  await expect.poll(() => requests.length).toBe(0);
  const chooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "添加附件", exact: true }).click();
  await (await chooser).setFiles([]);
  await editor.focus();
  await page.keyboard.press("Control+Enter");
  await expect(composer.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  await composer.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ expected_version: 0, operation_id: expect.any(String), tag_ids: [tag.id] });
  expect(JSON.stringify(requests[0].blocks)).toContain("跨刷新保留的灵感");
  await expect(editor).toHaveText("");
  await expect(composer.getByText("已记下", { exact: true })).toBeVisible();
});

test("quick note editing retains version and restores the record action focus after Escape", async ({ page }) => {
  await page.goto("/documents/quick-notes");
  const trigger = page.getByRole("button", { name: "编辑记录", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "编辑随手记", exact: true });
  await dialog.getByRole("textbox", { name: "随手记正文" }).fill("继续编辑的草稿");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByRole("textbox", { name: "随手记正文" })).toHaveText("继续编辑的草稿");
  let saved: Record<string, unknown> | undefined;
  await page.route(`**/quick-notes/${note.id}`, async route => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { code: "OK", message: "", request_id: "edit-note", data: { ...note, ...saved, version: 5 } } });
  });
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ expected_version: note.version, operation_id: expect.any(String) });
  await expect(dialog).toBeHidden();
});

test.describe("quick note touch controls", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 900 } });
  test("keeps format tools and selected tag removal reachable at 44px", async ({ page }) => {
    await page.goto("/documents/quick-notes");
    const composer = page.getByRole("region", { name: "快速记录", exact: true });
    const tool = composer.getByRole("button", { name: "加粗", exact: true });
    await expect(tool).toHaveCSS("width", "44px");
    await expect(tool).toHaveCSS("height", "44px");
    await composer.locator("summary").click();
    await composer.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
    const remove = composer.getByRole("button", { name: "移除标签 设计", exact: true });
    await expect(remove).toHaveCSS("min-width", "44px");
    await expect(remove).toHaveCSS("min-height", "44px");
    expect(await page.locator(".quick-notes-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});


test("quick notes remains keyboard reachable with forced colors and reduced motion", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/documents/quick-notes");
  const composer = page.getByRole("region", { name: "快速记录", exact: true });
  await expect(composer).toHaveCSS("box-shadow", "none");
  await composer.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(composer.locator(".quick-note-tag-options")).toBeVisible();
  await expect(composer.locator("summary")).toHaveCSS("outline-width", "2px");
  await composer.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
  await expect(composer.locator(".quick-note-selected-tag")).toContainText("设计");
});


test("quick note tag management keeps the narrow form, rename version and delete confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.route(`**/quick-note-tags/${tag.id}`, async route => {
    writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { code: "OK", message: "", request_id: "tag-write", data: { ...tag, name: "调整后的标签", version: 4 } } });
  });
  await page.goto("/documents/quick-notes");
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "管理标签", exact: true });
  await dialog.getByRole("button", { name: "重命名标签 设计", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "标签新名称", exact: true })).toHaveValue("设计");
  await dialog.getByRole("textbox", { name: "标签新名称", exact: true }).fill("调整后的标签");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ method: "PUT", body: { expected_version: tag.version, name: "调整后的标签", operation_id: expect.any(String) } });
  await dialog.getByRole("button", { name: "删除标签 设计", exact: true }).click();
  await expect(dialog.getByText("删除“设计”标签？已有记录会保留。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
});


for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  test(`quick notes ${theme} empty state at ${width}px uses the shared plain presentation`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.route(url => url.pathname.includes("/api/v1/") && url.pathname.endsWith("/quick-notes"), route => route.fulfill({ json: { code: "OK", message: "", request_id: "empty-notes", data: pageData([]) } }));
    await page.goto("/documents/quick-notes");
    const empty = page.locator(".quick-notes-empty");
    await expect(empty.getByRole("heading", { name: "记下第一个想法", exact: true })).toBeVisible();
    await expect(empty).toHaveAttribute("data-slot", "ob-empty-state");
    await expect(empty).toHaveCSS("min-height", "340px");
    await expect(empty).toHaveCSS("padding", "24px");
    await expect(empty).toHaveCSS("gap", "12px");
    expect(await empty.evaluate(element => [...element.children].map(child => child.tagName.toLowerCase()))).toEqual(["svg", "h2", "p"]);
    expect((await new AxeBuilder({ page }).include(".quick-notes-page").analyze()).violations).toEqual([]);
  });
}

test("quick note view options and record actions keep stable elements and the original patch intent", async ({ page }) => {
  let current = { ...note, deleted_at_ms: null as number | null };
  const writes: Array<Record<string, unknown>> = [];
  await page.route(url => url.pathname.includes("/api/v1/") && url.pathname.endsWith("/quick-notes"), async route => {
    const deleted = new URL(route.request().url()).searchParams.get("deleted") === "true";
    await route.fulfill({ json: { code: "OK", message: "", request_id: "action-notes", data: pageData((current.deleted_at_ms !== null) === deleted ? [current] : []) } });
  });
  await page.route(`**/quick-notes/${note.id}`, async route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    current = { ...current, is_pinned: body.is_pinned ?? current.is_pinned, deleted_at_ms: body.is_deleted === undefined ? current.deleted_at_ms : body.is_deleted ? now : null, version: current.version + 1 };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "action-patch", data: current } });
  });
  await page.goto("/documents/quick-notes");
  const view = page.getByRole("group", { name: "记录展示方式", exact: true });
  await expect(view.getByRole("button")).toHaveCount(2);
  expect(await view.getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), title: element.title, icon: element.querySelector("svg")?.getAttribute("width") })))).toEqual([
    { label: "列表视图", title: "列表视图", icon: "17" },
    { label: "卡片视图", title: "卡片视图", icon: "17" },
  ]);
  const cards = view.getByRole("button", { name: "卡片视图", exact: true });
  await cards.focus();
  await cards.press("Space");
  await expect(cards).toBeFocused();
  await expect(cards).toHaveAttribute("aria-pressed", "true");
  const card = page.getByRole("article", { name: "随手记记录", exact: true });
  await expect(card.getByRole("button")).toHaveCount(3);
  expect(await card.getByRole("button").evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), title: element.title, icon: element.querySelector("svg")?.getAttribute("width") })))).toEqual([
    { label: "编辑记录", title: "编辑记录", icon: "15" },
    { label: "取消置顶", title: "取消置顶", icon: "15" },
    { label: "移入回收站", title: "移入回收站", icon: "15" },
  ]);
  const pin = card.getByRole("button", { name: "取消置顶", exact: true });
  await pin.evaluate(element => element.setAttribute("data-action-identity", "original-pin"));
  await pin.click();
  const unpinned = card.getByRole("button", { name: "置顶记录", exact: true });
  await expect(unpinned).toHaveAttribute("data-action-identity", "original-pin");
  await card.getByRole("button", { name: "移入回收站", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "查看回收站", exact: true }).click();
  await expect(card.getByRole("button", { name: "恢复记录", exact: true })).toHaveAttribute("title", "恢复记录");
  await expect(card.getByRole("button")).toHaveCount(1);
  await expect(card.getByRole("button", { name: "恢复记录", exact: true }).locator("svg")).toHaveAttribute("width", "15");
  await card.getByRole("button", { name: "恢复记录", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(writes).toEqual([
    { is_pinned: false, expected_version: 4, operation_id: expect.any(String) },
    { is_deleted: true, expected_version: 5, operation_id: expect.any(String) },
    { is_deleted: false, expected_version: 6, operation_id: expect.any(String) },
  ]);
  expect(new Set(writes.map(write => write.operation_id)).size).toBe(3);
});
