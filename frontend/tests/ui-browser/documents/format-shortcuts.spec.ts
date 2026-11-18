import { expect, test } from "@playwright/test";
import { settleNativeEditorSelection } from "../../e2e/helpers/editor-selection";

for (const collaborative of [false, true]) test(`format shortcut preserves typed marks in ${collaborative ? "collaborative" : "local"} editor`, async ({ page }) => {
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto("/login");
  await page.evaluate(async collaborative => {
    const main = await (await fetch("/src/main.tsx")).text();
    const reactURL = main.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = main.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const app = await (await fetch("/src/app/App.tsx")).text();
    const routerURL = app.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const queries = await (await fetch("/src/features/documents/queries.ts")).text();
    const queryURL = queries.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const editorURL = "/src/features/documents/editor/TiptapEditor.tsx";
    const frameURL = "/src/features/documents/editor/EditorToolbarHost.tsx";
    const editorSource = await (await fetch(editorURL)).text();
    const coreURL = editorSource.match(/from\s*["']([^"']*@tiptap_core[^"']*)["']/)![1];
    const yPMURL = editorSource.match(/from\s*["']([^"']*y-prosemirror[^"']*)["']/)![1];
    const providerSource = await (await fetch("/src/features/documents/editor/collaboration-provider.ts")).text();
    const yURL = providerSource.match(/from\s*["']([^"']*\/yjs\.js[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, router, query, editor, { EditorToolbarFrame }, core, yPM, Y] = await Promise.all([
      import(reactURL), import(domURL), import(routerURL), import(queryURL), import(editorURL), import(frameURL), import(coreURL), import(yPMURL), import(yURL),
    ]);
    const blocks = { schema_version: 2, editor: "blocknote", blocks: [{ id: "format-paragraph", type: "paragraph", props: {}, content: [{ type: "text", text: "Shared base", styles: {} }], children: [] }] };
    const schema = core.getSchema(editor.collaborativeEditorExtensions(new Y.Doc()));
    const doc = yPM.prosemirrorJSONToYDoc(schema, { type: "doc", content: [{ type: "paragraph", attrs: { orbisId: "format-paragraph" }, content: [{ type: "text", text: "Shared base" }] }] }, "body");
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    document.body.append(host);
    function Preview() {
      const [value, setValue] = React.useState(blocks);
      return React.createElement(EditorToolbarFrame, null,
        React.createElement(editor.TiptapEditor, { blocks: value, collaborationDoc: collaborative ? doc : undefined, onChange: ({ blocks }: { blocks: typeof value }) => setValue(blocks) }),
        React.createElement("output", { "data-testid": "format-model", hidden: true }, JSON.stringify(value)));
    }
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient() }, React.createElement(router.MemoryRouter, null, React.createElement(Preview))));
  }, collaborative);
  const paragraph = page.locator(".ProseMirror p");
  await expect(paragraph).toHaveText("Shared base");
  await paragraph.click();
  const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
  await page.keyboard.press(apple ? "Meta+ArrowLeft" : "Home");
  await settleNativeEditorSelection(page);
  await page.keyboard.press("ControlOrMeta+B");
  await page.keyboard.type("B-bold ");
  await page.keyboard.press("ControlOrMeta+B");
  await expect(paragraph.locator("strong")).toHaveText("B-bold ");
  await expect(page.getByRole("button", { name: "粗体", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => {
    const blocks = JSON.parse(await page.getByTestId("format-model").textContent() ?? "null");
    return blocks.blocks[0].content.filter((run: { styles?: { bold?: boolean } }) => run.styles?.bold).map((run: { text: string }) => run.text).join("");
  }).toBe("B-bold ");
});
