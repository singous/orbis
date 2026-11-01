import type { Editor } from "@tiptap/core";
import { expect, test } from "@playwright/test";
import type { NoteBlocksV2 } from "../../../src/features/content/blocks";

for (const initialReadOnly of [true, false]) test(`document textbox mirrors ${initialReadOnly ? "read-only" : "editable"} permissions without replacing its editor`, async ({ page, context }, info) => {
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto("/login");
  await page.evaluate(async initialReadOnly => {
    const main = await (await fetch("/src/main.tsx")).text();
    const reactURL = main.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = main.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const app = await (await fetch("/src/app/App.tsx")).text();
    const routerURL = app.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const queries = await (await fetch("/src/features/documents/queries.ts")).text();
    const queryURL = queries.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const editorURL = "/src/features/documents/editor/TiptapEditor.tsx";
    const frameURL = "/src/features/documents/editor/EditorToolbarHost.tsx";
    const [{ default: React }, { default: ReactDOM }, router, query, { TiptapEditor }, { EditorToolbarFrame }] = await Promise.all([
      import(reactURL), import(domURL), import(routerURL), import(queryURL), import(editorURL), import(frameURL),
    ]);
    const initial: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [
      { id: "readonly-body", type: "paragraph", props: {}, content: [{ type: "text", text: "权限切换保留的正文", styles: {} }], children: [] },
    ] };
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    document.body.append(host);
    function Preview() {
      const [readOnly, setReadOnly] = React.useState(initialReadOnly);
      const [value, setValue] = React.useState(initial);
      const [changes, setChanges] = React.useState(0);
      return React.createElement(React.Fragment, null,
        React.createElement("button", { type: "button", onClick: () => setReadOnly((current: boolean) => !current) }, "切换编辑权限"),
        React.createElement(EditorToolbarFrame, null, React.createElement(TiptapEditor, {
          blocks: value,
          readOnly,
          onChange: ({ blocks }: { blocks: NoteBlocksV2 }) => { setValue(blocks); setChanges((current: number) => current + 1); },
        })),
        React.createElement("output", { "data-testid": "readonly-model", hidden: true }, JSON.stringify(value)),
        React.createElement("output", { "data-testid": "readonly-changes", hidden: true }, changes));
    }
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient() }, React.createElement(router.MemoryRouter, null, React.createElement(Preview))));
  }, initialReadOnly);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveText("权限切换保留的正文");
  const originalDOM = await editor.elementHandle();
  const originalEditor = await editor.evaluateHandle(element => (element as HTMLElement & { editor: Editor }).editor);
  const model = page.getByTestId("readonly-model");
  const initialModel = await model.textContent();
  const client = await context.newCDPSession(page);
  const states: unknown[] = [];
  try {
    for (const readOnly of [initialReadOnly, !initialReadOnly, initialReadOnly, !initialReadOnly, initialReadOnly]) {
      if (states.length) await page.getByRole("button", { name: "切换编辑权限", exact: true }).click();
      await expect(editor).toHaveAttribute("contenteditable", String(!readOnly));
      await expect(editor).toHaveRole("textbox");
      await expect(editor).toHaveAccessibleName("文档正文");
      await expect(editor).toHaveAttribute("aria-multiline", "true");
      await expect(editor).toHaveAttribute("aria-readonly", String(readOnly));
      expect(await editor.evaluate(element => element.ariaReadOnly)).toBe(String(readOnly));
      const { nodes } = await client.send("Accessibility.getFullAXTree");
      const textboxes = nodes.filter(node => node.role?.value === "textbox" && node.name?.value === "文档正文");
      expect(textboxes).toHaveLength(1);
      const properties = Object.fromEntries(textboxes[0].properties?.map(property => [property.name, property.value.value]) ?? []);
      expect(properties).toMatchObject({ readonly: readOnly, multiline: true });
      expect(properties.settable).toBe(readOnly ? undefined : true);
      expect(await editor.evaluate((element, original) => element === original, originalDOM)).toBe(true);
      expect(await editor.evaluate((element, original) => (element as HTMLElement & { editor: Editor }).editor === original, originalEditor)).toBe(true);
      await expect(editor).toHaveText("权限切换保留的正文");
      await expect(model).toHaveText(initialModel!);
      await expect(page.getByTestId("readonly-changes")).toHaveText("0");
      states.push({ readOnly, properties });
    }
  } finally {
    await client.detach();
    await info.attach("readonly-editor-states", { body: JSON.stringify({ initialReadOnly, states }), contentType: "application/json" });
  }
});
