import { expect, test } from "@playwright/test";
import { installSession, user, workspace } from "../fixtures/session";

for (const empty of [true, false]) test(`${empty ? "empty" : "tagged"} filters use pressed buttons and retain keyboard selection`, async ({ page }) => {
  await installSession(page);
  const tag = { id: "00000000-0000-4000-8000-000000000010", name: "工作", version: 1, count: 1, created_at_ms: 1, updated_at_ms: 1 };
  const note = { id: "00000000-0000-4000-8000-000000000011", workspace_id: workspace.id, owner_id: user.id, version: 1, blocks: [], tag_ids: [tag.id], is_pinned: false, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null };
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const items = path.endsWith("/quick-note-tags") ? empty ? [] : [tag] : path.endsWith("/quick-notes") ? empty ? [] : [note] : [];
    const data = path.endsWith("/quick-notes/summary") ? { total: empty ? 0 : 1, untagged: 0, deleted: 0 } : path.endsWith("/me") ? user : { items, pagination: { page: 1, page_size: 20, total: items.length } };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "e2e-tag-filters", data } });
  });
  await page.goto("/documents/quick-notes");
  const filters = page.getByRole("toolbar", { name: "按标签筛选", exact: true });
  const all = filters.getByRole("button", { name: `全部 (${empty ? 0 : 1})`, exact: true });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(filters.getByRole("button")).toHaveCount(empty ? 1 : 2);
  if (empty) return;
  const tagged = filters.getByRole("button", { name: "工作 (1)", exact: true });
  const filtered = page.waitForRequest(request => new URL(request.url()).searchParams.get("tag_id") === tag.id);
  await tagged.click();
  await filtered;
  await expect(tagged).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await tagged.click();
  await expect(tagged).toHaveAttribute("aria-pressed", "true");
  await tagged.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(all).toBeFocused();
  await page.keyboard.press("Space");
  await expect(all).toHaveAttribute("aria-pressed", "true");
});
