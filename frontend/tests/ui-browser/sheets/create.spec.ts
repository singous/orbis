import { expect, test } from "@playwright/test";
import { installSession, pagination, workspace } from "../fixtures/session";
import type { Notebook } from "../../../src/shared/api/schemas";

const notebook: Notebook = {
  id: "00000000-0000-4000-8000-000000000003", group_id: "00000000-0000-4000-8000-000000000004", workspace_id: workspace.id,
  title: "试点笔记本", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false,
  archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1,
};

test("create dialog keeps nested selection, locks while saving, and retries the same intent", async ({ page }) => {
  await installSession(page);
  const writes: Record<string, unknown>[] = [];
  let releaseSave: () => void = () => {};
  const pending = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/sheets") && request.method() === "POST") {
      writes.push(request.postDataJSON());
      if (writes.length === 1) await pending;
      await route.fulfill({ status: 503, json: { code: "UNAVAILABLE", message: "服务暂不可用，请重试", request_id: "sheet-ui", data: null } });
      return;
    }
    const data = path.endsWith("/sheets") ? { items: [], next_cursor: "" }
      : path.endsWith("/collections") ? { items: [notebook], pagination: { ...pagination, total: 1 } }
      : { items: [], pagination };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "sheet-ui", data } });
  });
  await page.goto("/sheets");
  const create = page.getByRole("button", { name: "新建数据表", exact: true }).first();
  await create.click();
  const dialog = page.getByRole("dialog", { name: "新建数据表", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("数据表名称", { exact: true }).fill("项目计划");
  const select = dialog.getByRole("combobox", { name: "所属笔记本", exact: true });
  await expect(select).toContainText("试点笔记本");
  await select.click();
  await expect(page.getByRole("option", { name: "试点笔记本", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(select).toBeFocused();
  await dialog.getByRole("button", { name: "任务跟踪 任务、状态与日期", exact: true }).click();
  await dialog.getByRole("button", { name: "创建数据表", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("数据表名称", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeVisible();
  releaseSave();
  const retry = dialog.getByRole("button", { name: "重试创建", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0]).toMatchObject({ collection_id: notebook.id, title: "项目计划", template: "tasks" });
  await expect(retry).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});
