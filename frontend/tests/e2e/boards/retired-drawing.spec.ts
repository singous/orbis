import { expect, test } from "@playwright/test";
import {
  createCollection,
  createDocument,
  openWithSession,
  ownerSession,
  responseData,
  sessionHeaders,
  workspacePath,
} from "../helpers/api-fixtures";

test("opening retired drawing content removes only the old blocks and inserts native boards from the editor", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request);
  const collection = await createCollection(
    request,
    session,
    "原生画板切换 " + Date.now(),
  );
  const doc = await createDocument(
    request,
    session,
    collection.id,
    "清理旧绘图",
  );
  const beforeID = crypto.randomUUID(),
    afterID = crypto.randomUUID(),
    drawingID = crypto.randomUUID();
  const paragraph = (id: string, text: string) => ({
    id,
    type: "paragraph",
    props: {},
    content: [{ text, marks: [], href: null }],
    children: [],
  });
  const oldScene = JSON.stringify({
    version: 1,
    elements: [
      { id: "old-shape", type: "rectangle", x: 0, y: 0, width: 40, height: 40 },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
  });
  const path = workspacePath(session, "/documents/" + doc.id + "/content");
  await responseData(
    await request.put(path, {
      headers: sessionHeaders(session),
      data: {
        operation_id: crypto.randomUUID(),
        expected_version: 1,
        title: doc.title,
        blocks: [
          paragraph(beforeID, "保留前面的正文"),
          {
            id: drawingID,
            type: "drawing",
            props: {
              scene: oldScene,
              caption: "不再使用的绘图",
              source: {
                type: "external",
                url: "https://example.test/retired-preview.png",
              },
            },
            content: [],
            children: [],
          },
          paragraph(afterID, "保留后面的正文"),
        ],
      },
    }),
  );
  const content = async () =>
    responseData(await request.get(path, { headers: sessionHeaders(session) }));
  expect((await content()).blocks.map((block: any) => block.type)).toEqual([
    "paragraph",
    "drawing",
    "paragraph",
  ]);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await openWithSession(page, session, "/documents/" + doc.id);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect
    .poll(async () => (await content()).blocks.map((block: any) => block.id))
    .toEqual([beforeID, afterID]);
  await expect(page.locator(".ProseMirror")).toContainText("保留前面的正文");
  await expect(page.locator(".ProseMirror")).toContainText("保留后面的正文");
  await expect(
    page.getByRole("button", { name: "编辑画板", exact: true }),
  ).toHaveCount(0);
  expect(
    requests.some((url) =>
      /retired-preview|excalidraw|drawing-assets/i.test(url),
    ),
  ).toBe(false);
  await page.reload();
  const tail = page.locator(`.ProseMirror [data-orbis-block-id="${afterID}"]`);
  await tail.click();
  await page.keyboard.press("End");
  await page.keyboard.type("，继续编辑");
  await expect
    .poll(async () =>
      (await content()).blocks
        .find((block: any) => block.id === afterID)
        .content.map((run: any) => run.text)
        .join(""),
    )
    .toBe("保留后面的正文，继续编辑");
  const native = await responseData(
    await request.post(workspacePath(session, "/boards"), {
      headers: sessionHeaders(session),
      data: {
        id: crypto.randomUUID(),
        operation_id: crypto.randomUUID(),
        page_id: crypto.randomUUID(),
        collection_id: collection.id,
        parent_id: null,
        title: "新版原生画板",
        elements: [],
      },
    }),
  );
  await tail.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/board");
  await page.getByRole("option", { name: "画板", exact: true }).click();
  await page.getByRole("button", { name: "选择画板", exact: true }).click();
  await page.getByRole("button", { name: "新版原生画板", exact: true }).click();
  await page.getByRole("button", { name: "插入画板", exact: true }).click();
  await expect
    .poll(async () =>
      (await content()).blocks.some(
        (block: any) =>
          block.type === "board" && block.props.board_id === native.id,
      ),
    )
    .toBe(true);
  await page.getByRole("link", { name: "打开画板", exact: true }).click();
  await expect(
    page.getByRole("application", { name: "画板编辑区域" }),
  ).toBeVisible();
  expect(requests.some((url) => /excalidraw|drawing-assets/i.test(url))).toBe(
    false,
  );
});
