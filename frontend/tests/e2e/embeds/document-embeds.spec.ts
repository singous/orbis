import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("board embeds preserve canvas state and save inline edits through full-screen round trips", async ({ page, request }) => {
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "嵌入画板验收");
  const doc = await createDocument(request, session, collection.id, "画板嵌入交互");
  const pageID = crypto.randomUUID();
  const shape = {
    id: crypto.randomUUID(), page_id: pageID, shape_type: "flow.process", shape_version: 1,
    geometry: { x: 100, y: 100, width: 180, height: 80, rotation_rad: 0 },
    style: { fill: "#ffffff", stroke: "#64748b", stroke_width: 1.5, font_size: 14, text_color: "#1e293b", opacity: 1, dashed: false, bold: false, align: "center" },
    text: "待确认", structure: { parent_id: null, order: 0, members: [], start: null, end: null, points: [], route: "straight", start_marker: "none", end_marker: "none", icon_id: "", asset_id: null, collapsed: false },
    version: 0, versions: { geometry: 0, style: 0, text: 0, structure: 0 },
  };
  const board = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null,
    title: "内嵌流程图", page_id: pageID, elements: [shape],
  } }));
  const binding = { board_id: board.id, page_id: pageID, mode: "live", revision: null, frame_id: null };
  await responseData(await request.put(workspacePath(session, `/documents/${doc.id}/content`), { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "画板嵌入交互", blocks: [
      { id: crypto.randomUUID(), type: "paragraph", props: {}, content: [{ text: "流程说明", marks: [] }], children: [] },
      { id: crypto.randomUUID(), type: "board", props: binding, content: [], children: [] },
    ],
  } }));
  await openWithSession(page, session, `/documents/${doc.id}`);
  const embed = page.locator(".embed-board");
  await expect(embed.getByRole("img", { name: "内嵌流程图" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("board-inline.png") });
  await embed.getByRole("button", { name: "放大画板", exact: true }).click();
  await expect(embed.getByRole("button", { name: "缩放比例 120%" })).toBeVisible();
  await embed.getByRole("button", { name: "全屏展开", exact: true }).click();
  await expect(embed).toHaveClass(/is-expanded/);
  await expect(embed.getByRole("button", { name: "缩放比例 120%" })).toBeVisible();
  await embed.getByRole("button", { name: "返回文档", exact: true }).click();
  await expect(embed).not.toHaveClass(/is-expanded/);
  await embed.getByRole("button", { name: "编辑画板", exact: true }).click();
  const canvas = embed.getByRole("application", { name: "画板编辑区域" });
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("board-edit-inline.png") });
  await expect(embed.locator(".board-save-state")).toHaveText("已保存");
  await canvas.focus();
  await canvas.press("ControlOrMeta+a");
  await canvas.press("Enter");
  await embed.getByRole("textbox", { name: "编辑图元文字" }).fill("原位修改已保存");
  await embed.getByRole("textbox", { name: "编辑图元文字" }).press("ControlOrMeta+Enter");
  await expect.poll(async () => {
    const data = await responseData(await request.get(workspacePath(session, `/boards/${board.id}/snapshot`), { headers }));
    return data.elements[0].text;
  }).toBe("原位修改已保存");
  await canvas.evaluate(element => element.setAttribute("data-instance", "retained"));
  await embed.getByRole("button", { name: "全屏展开", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-instance", "retained");
  await embed.getByRole("button", { name: "返回文档", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-instance", "retained");
  await embed.getByRole("button", { name: "撤销画板操作", exact: true }).click();
  await expect.poll(async () => (await responseData(await request.get(workspacePath(session, `/boards/${board.id}/snapshot`), { headers }))).elements[0].text).toBe("待确认");
  await embed.getByRole("button", { name: "结束编辑", exact: true }).click();
  await expect(embed.getByRole("toolbar", { name: "画板工具", exact: true })).not.toBeVisible();
  await expect(page.getByText("流程说明", { exact: true })).toBeVisible();
});

test("embedded data tables preserve search, cell selection and edits when expanded", async ({ page, request }) => {
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "嵌入数据表验收");
  const doc = await createDocument(request, session, collection.id, "数据表嵌入交互");
  await responseData(await request.put(workspacePath(session, `/documents/${doc.id}/content`), { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "数据表嵌入交互", blocks: [
      { id: crypto.randomUUID(), type: "paragraph", props: {}, content: [{ text: "任务清单如下", marks: [] }], children: [] },
    ],
  } }));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "数据表", exact: true }).click();
  const textField = { name: "文本" };
  const embed = page.locator(".embed-table");
  const grid = embed.getByRole("grid", { name: "数据表", exact: true });
  await embed.getByRole("button", { name: "添加记录", exact: true }).first().click();
  await grid.getByRole("gridcell").first().click();
  await page.getByRole("textbox", { name: "文本", exact: true }).fill("验收任务");
  await page.getByRole("textbox", { name: "文本", exact: true }).press("Enter");
  await expect(grid.getByRole("gridcell").first()).toHaveText("验收任务");
  const height = await embed.evaluate(element => element.getBoundingClientRect().height);
  expect(height).toBeLessThan(460);
  await grid.evaluate(element => element.setAttribute("data-instance", "retained"));
  await embed.getByRole("textbox", { name: "搜索记录" }).fill("验收");
  await expect(grid.getByRole("gridcell").first()).toHaveText("验收任务");
  await embed.getByRole("button", { name: "全屏展开", exact: true }).click();
  await expect(embed.getByRole("textbox", { name: "搜索记录" })).toHaveValue("验收");
  await embed.getByRole("button", { name: "字段管理", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "字段管理", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(embed).toHaveClass(/is-expanded/);
  await expect(grid).toHaveAttribute("data-instance", "retained");
  await page.screenshot({ path: test.info().outputPath("table-fullscreen.png") });
  await grid.getByRole("gridcell").first().dblclick();
  const input = page.getByRole("textbox", { name: textField.name, exact: true });
  await input.fill("验收已完成");
  await input.press("Enter");
  await expect(grid.getByRole("gridcell").first()).toHaveText("验收已完成");
  await embed.getByRole("button", { name: "返回文档", exact: true }).click();
  await expect(grid).toHaveAttribute("data-instance", "retained");
  await expect(embed.getByRole("textbox", { name: "搜索记录" })).toHaveValue("验收");
  await expect(grid.getByRole("gridcell").first()).toHaveText("验收已完成");
  await embed.getByRole("separator", { name: "调整嵌入高度" }).press("ArrowDown");
  expect(await embed.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(height);
  await embed.getByRole("button", { name: "恢复默认高度", exact: true }).click();
  await expect(page.getByText("任务清单如下", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(embed.getByRole("button", { name: "全屏展开", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("table-narrow.png") });
  expect(await embed.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
