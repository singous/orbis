import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("native board selections copy and cut through browser keyboard shortcuts", async ({ page, request }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "Keyboard clipboard " + Date.now());
  const doc = await createDocument(request, session, collection.id, "Board clipboard");
  const resource = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), page_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null, title: "Clipboard board", elements: [],
  } }));
  const lead = crypto.randomUUID(), first = crypto.randomUUID(), second = crypto.randomUUID();
  const binding = { board_id: resource.id, page_id: resource.pages[0].id, mode: "snapshot", revision: resource.revision, frame_id: null };
  const path = workspacePath(session, `/documents/${doc.id}/content`);
  await responseData(await request.put(path, { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: doc.title,
    blocks: [
      { id: lead, type: "paragraph", props: {}, content: [{ text: "Lead", marks: [] }], children: [] },
      { id: first, type: "board", props: binding, content: [], children: [] },
      { id: second, type: "board", props: binding, content: [], children: [] },
    ],
  } }));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.locator(`.ProseMirror [data-orbis-block-id="${lead}"]`).click();
  // Use the editor's node-selection command to avoid platform-specific arrow
  // navigation; copy and cut still travel through the real browser clipboard.
  await page.locator(".ProseMirror").evaluate((node, id) => {
    const editor = (node as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    let position = -1;
    editor.state.doc.descendants((child, pos) => { if (child.attrs.orbisId === id) { position = pos; return false; } });
    if (position < 0) throw new Error("Board selection target missing");
    editor.commands.setNodeSelection(position);
  }, first);
  await expect(page.locator('.ProseMirror [data-orbis-selected="true"]')).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+C");
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find(value => value.types.includes("text/html"))!;
    const html = new DOMParser().parseFromString(await (await item.getType("text/html")).text(), "text/html");
    return JSON.parse(html.querySelector("[data-orbis-block-clipboard]")!.getAttribute("data-orbis-block-clipboard")!);
  });
  expect(copied.blocks).toMatchObject([{ id: first, type: "board", props: binding }]);
  expect((await responseData(await request.get(path, { headers }))).blocks.filter((block: any) => block.type === "board")).toHaveLength(2);
  await page.keyboard.press("ControlOrMeta+X");
  await expect.poll(async () => (await responseData(await request.get(path, { headers }))).blocks.filter((block: any) => block.type === "board").map((block: any) => block.id)).toEqual([second]);
  await page.reload();
  await expect(page.locator(`.ProseMirror [data-orbis-block-id="${second}"]`)).toBeVisible();
});
