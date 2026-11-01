import type { Page } from "@playwright/test";
import { appendFileSync } from "node:fs";

export const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const noteId = id(1), userId = id(2), workspaceId = id(3), notebookId = id(4), commentId = id(5), versionId = id(6);
export const now = Date.parse("2026-11-01T00:00:00Z");
export const comment = { id: commentId, workspace_id: workspaceId, document_id: noteId, parent_id: null, author_id: userId, author_name: "文档作者", body: "第一条讨论\n第二行正文", is_resolved: false, resolved_at_ms: null, version: 3, created_at_ms: now, updated_at_ms: now };
export const version = { id: versionId, document_id: noteId, source_revision: 2, kind: "named", name: "评审稿", description: "评审前的固定内容", title: "产品计划", title_recorded: true, content_hash: "a".repeat(64), content_schema: "orbis.document-version.v1", author_id: userId, author_name: "文档作者", metadata_version: 2, captured_at_ms: now, created_at_ms: now, updated_at_ms: now };
export const nativeContent = { revision: { document_id: noteId, version: 2, title: "产品计划", title_recorded: true, author_id: userId, author_name: "文档作者", restored_from_version: null, created_at_ms: now }, blocks: [{ id: id(9), type: "paragraph", props: {}, content: [{ text: "固定版本正文", marks: [], href: null }], children: [] }] };
export const dataPage = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });

export async function mountDocumentSurface(page: Page, mode: "collaboration" | "sharing") {
  await page.goto("/__ui");
  await page.evaluate(async ({ mode, noteId, userId, notebookId }) => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const componentURL = mode === "collaboration" ? "/src/features/collaboration/DocumentCollaborationPanel.tsx" : "/src/features/sharing/ShareButton.tsx";
    const querySource = await (await fetch("/src/features/collaboration/queries.ts")).text();
    const queryURL = querySource.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, query, components] = await Promise.all([import(reactURL), import(domURL), import(queryURL), import(componentURL)]);
    const host = document.createElement("div");
    host.dataset.testid = "surface-preview";
    document.getElementById("root")!.hidden = true;
    document.body.append(host);
    function Surface() {
      const [open, setOpen] = React.useState(false);
      return mode === "sharing" ? React.createElement(components.ShareButton, { notebookId, noteId, title: "产品计划" }) : React.createElement(React.Fragment, null,
        React.createElement("button", { type: "button", onClick: () => setOpen(true) }, "打开评论与历史"),
        React.createElement(components.DocumentCollaborationPanel, { noteId, currentUserId: userId, canManage: true, open, onClose: () => setOpen(false), onRestore: async (restore: (version: number) => Promise<unknown>) => { await restore(4); }, onPrepareVersion: async () => 2 }));
    }
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(Surface)));
  }, { mode, noteId, userId, notebookId });
}

export async function captureDialogEvidence(page: Page, state: string, theme: string, width: number) {
  if (!process.env.ORBIS_SURFACE_EVIDENCE) return;
  const values = await page.getByRole("dialog").evaluate(element => {
    const selectors = [":scope", "header", "[role=tablist]", "textarea", "article", "input", "section", "button"];
    return selectors.flatMap(selector => (selector === ":scope" ? [element] : Array.from(element.querySelectorAll(selector))).slice(0, selector === "button" ? 5 : 1).map(node => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return { selector, text: node.textContent?.slice(0, 35), width: box.width, height: box.height, padding: style.padding, display: style.display, fontSize: style.fontSize, color: style.color, background: style.backgroundColor };
    }));
  });
  appendFileSync(process.env.ORBIS_SURFACE_EVIDENCE, JSON.stringify({ state, theme, width, values }) + "\n");
}

export async function installDocumentSurfaceSession(page: Page, theme: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(({ theme, userId, workspaceId }) => {
    localStorage.setItem("orbis.appearance", theme);
    localStorage.setItem("orbis.auth.v2", JSON.stringify({ accessToken: "surface-test", refreshToken: "refresh", credentialID: "surface-test", user: { id: userId, email: "author@orbis.test", display_name: "文档作者", bio: null, avatar_asset_id: null, preferred_workspace_id: workspaceId, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 }, workspace: { id: workspaceId, name: "测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } }));
  }, { theme, userId, workspaceId });
}
