import { expect, type Page } from "@playwright/test";
import { documentId } from "./document-editor";
import { installHomeFixture } from "./home";
import { initialSheet, sheetReadData } from "./sheet-workspace";

export const sheetRoutePath = `/documents/${initialSheet.document_id}`;

export async function installSheetRouteFixture(page: Page) {
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
}
