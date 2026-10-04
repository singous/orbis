import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

const credentials = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

async function prepare(page: Page, request: APIRequestContext) {
  const setup = await request.post("/api/setup", { data: { ...credentials, display_name: "搜索弹层验收" } });
  expect([201, 409]).toContain(setup.status());
  const login = await request.post("/api/auth/login", { data: credentials });
  expect(login.status()).toBe(200);
  const auth = (await login.json()).data;
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const marker = `palette-${Date.now()}`;
  const notebookResponse = await request.post("/api/notebooks", { headers, data: { title: `${marker}笔记本` } });
  expect(notebookResponse.status()).toBe(201);
  const notebook = (await notebookResponse.json()).data;
  const notes: { id: string; title: string }[] = [];
  for (const label of ["当前草稿", "目标文档"]) {
    const created = await request.post("/api/notes", { headers, data: { notebook_id: notebook.id, title: `${marker}${label}` } });
    expect(created.status()).toBe(201);
    notes.push((await created.json()).data);
  }
  const saved = await request.put(`/api/notes/${notes[0].id}/content`, { headers, data: {
    expected_version: 1,
    blocks: { schema_version: 2, editor: "blocknote", blocks: Array.from({ length: 60 }, (_, index) => ({
      id: `palette-paragraph-${index}`, type: "paragraph", props: {}, children: [],
      content: [{ type: "text", text: `搜索弹层背景段落 ${index + 1}`, styles: {} }],
    })) },
  } });
  expect(saved.status()).toBe(200);
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto(`/documents/${notes[0].id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return { notes, headers, marker };
}

test("opening and closing search preserves the active editor, unsaved content, URL and scroll", async ({ page, request }) => {
  const { notes } = await prepare(page, request);
  let releaseSave!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route(`**/api/notes/${notes[0].id}/content`, async route => {
    if (["PUT", "PATCH"].includes(route.request().method())) await saveGate;
    await route.continue();
  });
  try {
    const editor = page.locator(".ProseMirror");
    await editor.evaluate(element => element.setAttribute("data-preserved-editor", "true"));
    await editor.locator("p").first().click();
    // End starts native page scrolling on macOS; typing needs no navigation key.
    await page.keyboard.insertText(" 未保存内容必须保留");
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("Shift+ArrowLeft");
    const settleFrames = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await settleFrames();
    const scroll = page.locator(".document-scroll-region");
    await scroll.evaluate(element => { element.scrollTop = 300; });
    await settleFrames();
    await scroll.evaluate(element => {
      // Window capture precedes the app's document-capture shortcut owner.
      // Observe the real opening key, after Playwright's modifier-key sequence.
      function recordAtOpen(event: KeyboardEvent) {
        if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
        const editor = document.querySelector(".ProseMirror");
        const selection = getSelection();
        element.setAttribute("data-search-open-context", JSON.stringify({
          scroll: element.scrollTop,
          selection: { inside: editor?.contains(selection?.anchorNode ?? null), anchor: selection?.anchorOffset, focus: selection?.focusOffset, text: selection?.anchorNode?.textContent },
        }));
        window.removeEventListener("keydown", recordAtOpen, true);
      }
      window.addEventListener("keydown", recordAtOpen, true);
    });
    const initialUrl = page.url();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
    const input = palette.getByRole("combobox", { name: "搜索任何内容", exact: true });
    await expect(input).toBeFocused();
    const openContext = JSON.parse((await scroll.getAttribute("data-search-open-context"))!);
    const initialScroll = openContext.scroll as number;
    const selectionBefore = openContext.selection;
    expect(initialScroll).toBeGreaterThan(0);
    expect(selectionBefore.inside).toBe(true);
    expect(selectionBefore.anchor).toBeGreaterThan(selectionBefore.focus);
    await input.fill("不会修改背景页面的关键词");
    await expect(page).toHaveURL(initialUrl);
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await settleFrames();
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(initialScroll, 0);
    // ProseMirror restores its DOM selection after a delayed focus callback.
    // The return position must stay stable after that callback has run.
    await page.waitForTimeout(50);
    await expect(page).toHaveURL(initialUrl);
    await expect(editor).toHaveAttribute("data-preserved-editor", "true");
    await expect(editor).toContainText("未保存内容必须保留");
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(initialScroll, 0);
    await expect(editor).toBeFocused();
    expect(await editor.evaluate(element => {
      const selection = getSelection();
      return { inside: element.contains(selection?.anchorNode ?? null), anchor: selection?.anchorOffset, focus: selection?.focusOffset, text: selection?.anchorNode?.textContent };
    })).toEqual(selectionBefore);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).not.toContainText("未保存内容必须保留");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(editor).toContainText("未保存内容必须保留");
  } finally {
    releaseSave();
  }
  await expect(page.locator(".document-save-state")).toContainText("已保存");
});

test("keyboard type selection searches real documents and opens the selected result", async ({ page, request }) => {
  const { notes } = await prepare(page, request);
  const before = page.url();
  await page.getByRole("complementary", { name: "应用导航", exact: true }).getByRole("button", { name: "搜索", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
  const input = palette.getByRole("combobox", { name: "搜索任何内容", exact: true });
  await input.fill("@");
  const documentType = palette.getByRole("option", { name: /@doc/ });
  await expect(documentType).toBeVisible();
  await expect(palette.getByRole("option")).toHaveCount(5);
  await input.press("Enter");
  await expect(input).toHaveValue("@doc ");
  await input.fill(`@doc ${notes[1].title}`);
  const target = palette.locator("[data-search-result]").filter({ hasText: notes[1].title });
  await expect(target).toBeVisible();
  await expect(palette.locator("[data-search-result]")).toHaveCount(1);
  await expect(page).toHaveURL(before);
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/documents/${notes[1].id}$`));
  await expect(page.getByRole("dialog", { name: "全局搜索", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "文档标题", exact: true })).toHaveValue(notes[1].title);
});

for (const outcome of ["saved", "conflict"] as const) {
  test(`result opening waits for the active draft and ${outcome === "saved" ? "navigates only after a successful save" : "stays in place after a conflict"}`, async ({ page, request }) => {
    const { notes, headers } = await prepare(page, request);
    let releaseSave!: () => void;
    let saveStarted = false;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    await page.route(`**/api/notes/${notes[0].id}/content`, async route => {
      if (!["PUT", "PATCH"].includes(route.request().method())) { await route.continue(); return; }
      saveStarted = true;
      await saveGate;
      if (outcome === "conflict") {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({
          code: "NOTE_VERSION_CONFLICT", message: "正文版本冲突", request_id: "palette-conflict", data: null,
        }) });
      } else await route.continue();
    });
    const draftMarker = ` 未保存的打开前草稿-${outcome}`;
    const editor = page.locator(".ProseMirror");
    await editor.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(draftMarker);
    const before = page.url();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await palette.getByRole("combobox", { name: "搜索任何内容", exact: true }).fill(notes[1].title);
    await palette.locator("[data-search-result]").filter({ hasText: notes[1].title }).click();
    try {
      await expect.poll(() => saveStarted).toBe(true);
      await expect(page).toHaveURL(before);
      await expect(palette).toBeVisible();
      await expect(editor).toContainText(draftMarker.trim());
    } finally { releaseSave(); }
    if (outcome === "saved") {
      await expect(page).toHaveURL(new RegExp(`/documents/${notes[1].id}$`));
      const stored = await request.get(`/api/notes/${notes[0].id}/content`, { headers });
      expect(stored.status()).toBe(200);
      expect((await stored.json()).data.plain_text).toContain(draftMarker.trim());
    } else {
      await expect(palette.getByRole("alert")).toContainText(/草稿|保存|冲突/);
      await expect(page).toHaveURL(before);
      await expect(editor).toContainText(draftMarker.trim());
      await page.keyboard.press("Escape");
      await expect(editor).toBeVisible();
      await expect(page.locator(".document-save-state")).toContainText("版本冲突");
    }
  });
}

test("home and document-menu entries seed the same palette without route changes", async ({ page, request }) => {
  const { notes } = await prepare(page, request);
  await page.goto("/home");
  const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await page.getByRole("button", { name: /^全局搜索/ }).click();
  await expect(palette).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox", { name: "搜索文档", exact: true }).fill(notes[1].title);
  await page.getByRole("searchbox", { name: "搜索文档", exact: true }).press("Enter");
  await expect(palette.getByRole("combobox", { name: "搜索任何内容", exact: true })).toHaveValue(`@doc ${notes[1].title}`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(palette.locator("[data-search-result]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.goto("/documents");
  await page.getByRole("navigation", { name: "文档导航", exact: true }).getByRole("button", { name: "搜索文档", exact: true }).click();
  await expect(palette.getByRole("combobox", { name: "搜索任何内容", exact: true })).toHaveValue("@doc ");
  await expect(page).toHaveURL(/\/documents$/);
});

test("a 320px viewport with doubled fonts keeps all search categories reachable without horizontal overflow", async ({ page, request }) => {
  await prepare(page, request);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await expect(palette).toBeVisible();
  const categories = palette.getByRole("option");
  await expect(categories).toHaveCount(5);
  await categories.last().scrollIntoViewIfNeeded();
  await expect(categories.last()).toBeVisible();
  const geometry = await palette.evaluate(element => {
    const box = element.getBoundingClientRect();
    const content = element.querySelector<HTMLElement>(".search-palette-content")!;
    const footer = element.querySelector<HTMLElement>(".search-palette-footer")!;
    const footerBox = footer.getBoundingClientRect();
    const closeBox = footer.querySelector<HTMLElement>('[aria-label="关闭搜索"]')!.getBoundingClientRect();
    return {
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      left: box.left, right: box.right, bottom: box.bottom,
      contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth,
      contentHeight: content.clientHeight, contentScrollHeight: content.scrollHeight,
      footerLeft: footerBox.left, footerRight: footerBox.right, footerTop: footerBox.top, footerBottom: footerBox.bottom,
      footerWidth: footer.clientWidth, footerScrollWidth: footer.scrollWidth,
      closeLeft: closeBox.left, closeRight: closeBox.right, closeTop: closeBox.top, closeBottom: closeBox.bottom,
      cards: Array.from(content.querySelectorAll<HTMLElement>("[role=option]")).map(card => ({
        clientWidth: card.clientWidth, scrollWidth: card.scrollWidth,
        left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right,
      })),
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.contentScrollWidth).toBeLessThanOrEqual(geometry.contentWidth + 1);
  expect(geometry.contentScrollHeight).toBeGreaterThan(geometry.contentHeight);
  expect(geometry.footerLeft).toBeGreaterThanOrEqual(geometry.left);
  expect(geometry.footerRight).toBeLessThanOrEqual(geometry.right);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.footerScrollWidth).toBeLessThanOrEqual(geometry.footerWidth + 1);
  expect(geometry.closeLeft).toBeGreaterThanOrEqual(geometry.footerLeft);
  expect(geometry.closeRight).toBeLessThanOrEqual(geometry.footerRight);
  expect(geometry.closeTop).toBeGreaterThanOrEqual(geometry.footerTop);
  expect(geometry.closeBottom).toBeLessThanOrEqual(geometry.footerBottom);
  for (const card of geometry.cards) {
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
    expect(card.left).toBeGreaterThanOrEqual(geometry.left);
    expect(card.right).toBeLessThanOrEqual(geometry.right);
  }
});
