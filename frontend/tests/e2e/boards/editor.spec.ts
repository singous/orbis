import { expect, test } from "@playwright/test";
import {
  ownerSession,
  createCollection,
  openWithSession,
  responseData,
  workspacePath,
  sessionHeaders,
} from "../helpers/api-fixtures";

test("native board templates persist and editing supports undo, deletion and recovery", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 2048, height: 1157 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      "画板验收 " + Date.now(),
    );
  await openWithSession(page, session, "/collections/" + collection.id);
  await page.getByRole("button", { name: "创建内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "画板", exact: true }).click();
  await expect(
    page.getByRole("application", { name: "画板编辑区域" }),
  ).toBeVisible();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  const keyboardWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/commands"))
      keyboardWrites.push(request.url());
  });
  const canvas = page.getByRole("application", { name: "画板编辑区域" });
  await canvas.focus();
  for (const key of ["Delete", "Backspace", "ArrowUp", "ArrowRight"])
    await canvas.press(key);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(keyboardWrites).toEqual([]);
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await page.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await expect(page.locator(".board-page-actions")).toContainText("12 个对象");
  const documentID = page.url().split("/documents/")[1]?.split("?")[0];
  const document = await responseData(
    await request.get(workspacePath(session, "/documents/" + documentID), {
      headers: sessionHeaders(session),
    }),
  );
  const snapshot = async () =>
    responseData(
      await request.get(
        workspacePath(session, "/boards/" + document.board_id + "/snapshot"),
        { headers: sessionHeaders(session) },
      ),
    );
  await expect.poll(async () => (await snapshot()).elements.length).toBe(12);
  await expect
    .poll(() =>
      page
        .locator(".board-canvas canvas")
        .first()
        .evaluate((canvas: HTMLCanvasElement) =>
          canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0),
        ),
    )
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("board-flow.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "页面与图层", exact: true }).click();
  await page
    .locator(".board-object-list")
    .getByRole("listitem")
    .filter({ hasText: "资料核验" })
    .click();
  await page.getByRole("button", { name: "收起素材库", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "画板属性" })).toHaveCount(0);
  await page.getByRole("button", { name: "设置选中对象", exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath("board-dify-frame.png"),
    animations: "disabled",
  });
  await page
    .getByRole("textbox", { name: "文字", exact: true })
    .fill("核验资料与权限");
  await page.getByRole("textbox", { name: "文字", exact: true }).press("Enter");
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await expect
    .poll(async () =>
      (await snapshot()).elements.some((e: any) => e.text === "核验资料与权限"),
    )
    .toBe(true);
  await page
    .getByRole("textbox", { name: "文字", exact: true })
    .fill("第二次文字修改");
  await page.getByRole("textbox", { name: "文字", exact: true }).press("Enter");
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  for (const text of ["核验资料与权限", "资料核验"]) {
    await page
      .getByRole("button", { name: "撤销画板操作", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await snapshot()).elements.some((e: any) => e.text === text),
      )
      .toBe(true);
    await expect(page.locator(".board-save-state")).toHaveText("已保存");
  }
  for (const text of ["核验资料与权限", "第二次文字修改"]) {
    await page
      .getByRole("button", { name: "重做画板操作", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await snapshot()).elements.some((e: any) => e.text === text),
      )
      .toBe(true);
    await expect(page.locator(".board-save-state")).toHaveText("已保存");
  }
  await page.getByRole("button", { name: "撤销画板操作", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot()).elements.some((e: any) => e.text === "核验资料与权限"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "重做画板操作", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot()).elements.some((e: any) => e.text === "第二次文字修改"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "删除所选对象", exact: true }).click();
  await expect
    .poll(async () => (await snapshot()).elements.length)
    .toBeLessThan(12);
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await page.getByRole("button", { name: "撤销画板操作", exact: true }).click();
  await expect.poll(async () => (await snapshot()).elements.length).toBe(12);
  await page.reload();
  await expect(
    page.getByRole("application", { name: "画板编辑区域" }),
  ).toBeVisible();
  await expect(page.locator(".board-page-actions")).toContainText("12 个对象");
  await page.getByRole("button", { name: "切换素材面板", exact: true }).click();
  await page.getByRole("tab", { name: "图标", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索画板素材" }).fill("server");
  await page
    .getByRole("button", { name: "插入图标 server", exact: true })
    .click();
  await expect.poll(async () => (await snapshot()).elements.length).toBe(13);
  await page.getByRole("button", { name: "添加画板页面", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "页面 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "页面 2", exact: true }).click();
  await expect(page.locator(".board-page-actions")).toContainText("0 个对象");
  await page.getByRole("tablist", { name: "画板页面" }).getByRole("tab").first().click();
  await page.getByRole("button", { name: "页面与图层", exact: true }).click();
  await page
    .locator(".board-object-list")
    .getByRole("listitem")
    .filter({ hasText: "第二次文字修改" })
    .click();
  await page.getByRole("button", { name: "设置选中对象", exact: true }).click();
  await page
    .getByRole("textbox", { name: "文字", exact: true })
    .fill("跨页修改");
  await page.getByRole("textbox", { name: "文字", exact: true }).press("Enter");
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await page.getByRole("tab", { name: "页面 2", exact: true }).click();
  await page.getByRole("button", { name: "撤销画板操作", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot()).elements.some((e: any) => e.text === "第二次文字修改"),
    )
    .toBe(true);
  await expect(
    page.getByRole("tablist", { name: "画板页面" }).getByRole("tab").first(),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "重做画板操作", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot()).elements.some((e: any) => e.text === "跨页修改"),
    )
    .toBe(true);
  await expect.poll(async () => (await snapshot()).elements.length).toBe(13);
  await page.getByRole("tab", { name: "页面 2", exact: true }).click();
  await page.getByRole("tab", { name: "模板", exact: true }).click();
  await page.getByRole("button", { name: /图类型/ }).click();
  await page.getByRole("option", { name: "ER 图", exact: true }).click();
  await page.getByRole("button", { name: /用户权限/ }).click();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await expect.poll(async () => (await snapshot()).elements.length).toBe(22);
  await page.screenshot({
    path: test.info().outputPath("board-er.png"),
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("images survive portable export/import and PNG export", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      "Portable board " + Date.now(),
    );
  const board = await responseData(
    await request.post(workspacePath(session, "/boards"), {
      headers: sessionHeaders(session),
      data: {
        id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        collection_id: collection.id,
        parent_id: null,
        title: "图片画板",
        page_id: crypto.randomUUID(),
        elements: [],
      },
    }),
  );
  await openWithSession(page, session, "/documents/" + board.document_id);
  await expect(
    page.getByRole("application", { name: "画板编辑区域" }),
  ).toBeVisible();
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3457ff";
      ctx.fillRect(0, 0, 64, 48);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await page
    .locator('input[type=file][accept^="image/png"]')
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  const snapshot = async () =>
    responseData(
      await request.get(
        workspacePath(session, "/boards/" + board.id + "/snapshot"),
        { headers: sessionHeaders(session) },
      ),
    );
  await expect.poll(async () => (await snapshot()).elements.length).toBe(1);
  await page.getByRole("button", { name: "导入与导出画板", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "当前页可编辑文件", exact: true })
    .click();
  const path = await (await exported).path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path!);
  const portable = JSON.parse(bytes.toString());
  expect(portable.assets).toHaveLength(1);
  expect(portable.board.pages).toHaveLength(1);
  await page
    .locator('input[type=file][accept=".json,.orbis-board.json"]')
    .setInputFiles({
      name: "copy.orbis-board.json",
      mimeType: "application/json",
      buffer: bytes,
    });
  await expect.poll(async () => (await snapshot()).board.pages.length).toBe(2);
  await expect.poll(async () => (await snapshot()).elements.length).toBe(2);
  const latest = await snapshot();
  expect(new Set(latest.elements.map((e: any) => e.id)).size).toBe(2);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导入与导出画板", exact: true }).click();
  await page.getByRole("menuitem", { name: "PNG", exact: true }).click();
  expect(
    (await readFile((await (await pngDownload).path())!))
      .subarray(1, 4)
      .toString(),
  ).toBe("PNG");
  const preview = await request.get(
    workspacePath(
      session,
      "/boards/" + board.id + "/preview?page_id=" + board.pages[0].id,
    ),
    { headers: sessionHeaders(session) },
  );
  expect(preview.ok()).toBeTruthy();
  expect(await preview.text()).toContain("data:image/png;base64,");
});

test("a lost save response is recovered after reload with the original operation id", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      "Recovery " + Date.now(),
    );
  const board = await responseData(
    await request.post(workspacePath(session, "/boards"), {
      headers: sessionHeaders(session),
      data: {
        id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        collection_id: collection.id,
        parent_id: null,
        title: "恢复测试",
        page_id: crypto.randomUUID(),
        elements: [],
      },
    }),
  );
  let first = true,
    online = false;
  const operations = new Set<string>();
  await page.route("**/boards/" + board.id + "/commands", async (route) => {
    operations.add(route.request().postDataJSON().operation_id);
    if (online) {
      await route.continue();
      return;
    }
    if (first) {
      first = false;
      await route.fetch();
    }
    await route.abort("connectionreset");
  });
  await openWithSession(page, session, "/documents/" + board.document_id);
  await page.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText(
    "离线，修改保存在本机",
  );
  const snapshot = async () =>
    responseData(
      await request.get(
        workspacePath(session, "/boards/" + board.id + "/snapshot"),
        { headers: sessionHeaders(session) },
      ),
    );
  await expect.poll(async () => (await snapshot()).elements.length).toBe(12);
  online = true;
  await page.reload();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  expect(operations.size).toBe(1);
  expect((await snapshot()).elements).toHaveLength(12);
});

test("mind map keyboard editing and native document embeds preserve board references", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      "Embedded diagram " + Date.now(),
    );
  const board = await responseData(
    await request.post(workspacePath(session, "/boards"), {
      headers: sessionHeaders(session),
      data: {
        id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        collection_id: collection.id,
        parent_id: null,
        title: "产品规划",
        page_id: crypto.randomUUID(),
        elements: [],
      },
    }),
  );
  await openWithSession(page, session, "/documents/" + board.document_id);
  await page.getByRole("button", { name: "模板库", exact: true }).click();
  await page.getByRole("button", { name: /图类型/ }).click();
  await page.getByRole("option", { name: "思维导图", exact: true }).click();
  await page
    .locator(".board-template-list")
    .getByRole("button", { name: /项目规划/ })
    .click();
  const snapshot = async () =>
    responseData(
      await request.get(
        workspacePath(session, "/boards/" + board.id + "/snapshot"),
        { headers: sessionHeaders(session) },
      ),
    );
  await expect.poll(async () => (await snapshot()).elements.length).toBe(25);
  await page.getByRole("button", { name: "页面与图层", exact: true }).click();
  await page
    .locator(".board-object-list")
    .getByRole("listitem")
    .filter({ hasText: "项目规划" })
    .click();
  const canvas = page.getByRole("application", { name: "画板编辑区域" });
  await canvas.focus();
  await canvas.press("Tab");
  await expect.poll(async () => (await snapshot()).elements.length).toBe(27);
  await canvas.press("Enter");
  await expect.poll(async () => (await snapshot()).elements.length).toBe(29);
  await page.getByRole("button", { name: "收起素材库", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("board-mobile.png"),
    animations: "disabled",
  });
  const doc = await responseData(
    await request.post(
      workspacePath(session, "/collections/" + collection.id + "/documents"),
      {
        headers: sessionHeaders(session),
        data: { title: "包含画板的正文", parent_id: null },
      },
    ),
  );
  const binding = {
    board_id: board.id,
    page_id: board.pages[0].id,
    mode: "snapshot",
    revision: (await snapshot()).board.revision,
    frame_id: null,
  };
  await responseData(
    await request.put(
      workspacePath(session, "/documents/" + doc.id + "/content"),
      {
        headers: sessionHeaders(session),
        data: {
          operation_id: crypto.randomUUID(),
          expected_version: 1,
          title: "包含画板的正文",
          blocks: [
            {
              id: crypto.randomUUID(),
              type: "paragraph",
              props: {},
              content: [{ text: "图文结合的产品说明", marks: [] }],
              children: [],
            },
            {
              id: crypto.randomUUID(),
              type: "board",
              props: binding,
              content: [],
              children: [],
            },
          ],
        },
      },
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/documents/" + doc.id);
  const embedded = page.locator(".board-embed img").first();
  await expect(embedded).toBeVisible();
  await expect
    .poll(() =>
      embedded.evaluate(
        (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath("board-embedded.png"),
    animations: "disabled",
  });
  await page.reload();
  await expect(page.locator(".board-embed img").first()).toBeVisible();
  expect(
    (
      await responseData(
        await request.get(
          workspacePath(session, "/documents/" + doc.id + "/content"),
          { headers: sessionHeaders(session) },
        ),
      )
    ).blocks.some(
      (b: any) => b.type === "board" && b.props.board_id === board.id,
    ),
  ).toBe(true);
});

test("container layout and connected field deletion preserve the rest of the diagram", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 2048, height: 1157 });
  const session = await ownerSession(request);
  const collection = await createCollection(
    request,
    session,
    "结构编辑 " + Date.now(),
  );
  await openWithSession(page, session, "/collections/" + collection.id);
  await page.getByRole("button", { name: "创建内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "画板", exact: true }).click();
  await page.getByRole("button", { name: "三层应用", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  const documentID = page.url().split("/documents/")[1]?.split("?")[0];
  const document = await responseData(
    await request.get(workspacePath(session, "/documents/" + documentID), {
      headers: sessionHeaders(session),
    }),
  );
  const snapshot = async () =>
    responseData(
      await request.get(
        workspacePath(session, "/boards/" + document.board_id + "/snapshot"),
        { headers: sessionHeaders(session) },
      ),
    );
  await expect
    .poll(async () =>
      (await snapshot()).elements.some(
        (element: any) => element.shape_type === "architecture.boundary",
      ),
    )
    .toBe(true);
  const before = await snapshot();
  const root = before.elements.find(
    (element: any) => element.shape_type === "architecture.boundary",
  );
  const children = before.elements.filter(
    (element: any) =>
      element.structure.parent_id === root.id &&
      element.shape_type !== "connector",
  );
  expect(children.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "页面与图层", exact: true }).click();
  await page
    .locator(".board-object-list")
    .getByRole("listitem")
    .filter({ hasText: root.text })
    .click();
  await page.getByRole("button", { name: "自动布局", exact: true }).click();
  await expect
    .poll(async () => {
      const moved = (await snapshot()).elements.find(
        (element: any) => element.id === root.id,
      );
      return (
        moved.geometry.x !== root.geometry.x ||
        moved.geometry.y !== root.geometry.y
      );
    })
    .toBe(true);
  const after = await snapshot(),
    movedRoot = after.elements.find((element: any) => element.id === root.id);
  for (const child of children) {
    const moved = after.elements.find(
      (element: any) => element.id === child.id,
    );
    expect(moved.geometry.x - movedRoot.geometry.x).toBeCloseTo(
      child.geometry.x - root.geometry.x,
    );
    expect(moved.geometry.y - movedRoot.geometry.y).toBeCloseTo(
      child.geometry.y - root.geometry.y,
    );
  }
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await page.getByRole("tab", { name: "模板", exact: true }).click();
  await page.getByRole("button", { name: /图类型/ }).click();
  await page.getByRole("option", { name: "ER 图", exact: true }).click();
  await page.getByRole("button", { name: /用户权限/ }).click();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await expect
    .poll(async () =>
      (await snapshot()).elements.some(
        (element: any) => element.shape_type === "er.entity",
      ),
    )
    .toBe(true);
  const er = await snapshot();
  const edge = er.elements.find(
    (element: any) =>
      element.shape_type === "connector" &&
      element.structure.start?.port.includes(":"),
  );
  const endpoint = edge.structure.start;
  const entity = er.elements.find(
    (element: any) => element.id === endpoint.element_id,
  );
  const memberID = endpoint.port.split(":")[1];
  const member = entity.structure.members.find(
    (value: any) => value.id === memberID,
  );
  await page.getByRole("button", { name: "页面与图层", exact: true }).click();
  await page
    .locator(".board-object-list")
    .getByRole("listitem")
    .filter({ has: page.getByText(entity.text, { exact: true }) })
    .click();
  await page.getByRole("button", { name: "收起素材库", exact: true }).click();
  await page.getByRole("button", { name: "设置选中对象", exact: true }).click();
  await page
    .getByRole("button", { name: "删除字段 " + member.name, exact: true })
    .click();
  await expect
    .poll(async () =>
      (await snapshot()).elements
        .find((element: any) => element.id === entity.id)
        .structure.members.some((value: any) => value.id === memberID),
    )
    .toBe(false);
  const removed = await snapshot();
  expect(removed.elements.length).toBe(er.elements.length);
  expect(
    removed.elements.find((element: any) => element.id === edge.id).structure
      .start.port,
  ).toBe(endpoint.port.split(":")[0]);
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await page.getByRole("button", { name: "撤销画板操作", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot()).elements.find(
          (element: any) => element.id === edge.id,
        ).structure.start.port,
    )
    .toBe(endpoint.port);
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
});
