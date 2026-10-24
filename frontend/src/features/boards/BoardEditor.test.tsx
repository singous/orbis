import { toast as heroToast } from "@heroui/react/toast";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { Toaster } from "../../shared/ui/Toast";
import type { Board } from "./model";
import type { SessionState } from "./session";
import { BoardEditor } from "./BoardEditor";

vi.mock("../../shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ workspaceId: "workspace", accessToken: "test" }) }));
vi.mock("../sharing/ShareButton", () => ({ ShareButton: () => <button>分享</button> }));
vi.mock("./BoardShell", () => ({ BoardShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("./BoardCanvas", () => ({ BoardCanvas: ({ onSelection, selectionActions }: { onSelection: (ids: Set<string>) => void; selectionActions: React.ReactNode }) => <>
  <div role="application" aria-label="画板编辑区域" />
  <button onClick={() => onSelection(new Set(["sample"]))}>选中测试对象</button>
  <button onClick={() => onSelection(new Set())}>清除测试选择</button>
  {selectionActions}
</> }));
vi.mock("./BoardMinimap", () => ({ BoardMinimap: () => null }));
vi.mock("./session", async () => {
  const { makeElement } = await import("./model");
  return {
  BoardSession: class {
    listeners = new Set<() => void>();
    state: SessionState = {
      board: {
        id: "board", collection_id: "notebook", document_id: "document", workspace_id: "workspace",
        title: "页签验证", schema_version: 1, revision: 0, created_at_ms: 1, updated_at_ms: 1,
        pages: [
          { id: "first", name: "页面 1", background: "#fff", position: 0, version: 1 },
          { id: "second", name: "页面 2", background: "#fff", position: 1, version: 1 },
        ],
      } satisfies Board,
      elements: new Map([["sample", { ...makeElement("flow.process", "first", 0, 0), id: "sample" }]]), pageID: "first", status: "saved", error: null, pending: 0, canUndo: false, canRedo: false,
    };
    start = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn();
    getSnapshot = () => this.state;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    switchPage = async (id: string) => {
      this.state = { ...this.state, pageID: id, elements: new Map() };
      for (const listener of this.listeners) listener();
    };
  },
}; });
beforeEach(() => {
  authStore.setState({ workspace: { id: "workspace", name: "验收空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); heroToast.clear(); authStore.getState().clearSession(); });

it("reports another identical import failure after its notification was dismissed", async () => {
  const view = render(<><BoardEditor id="board" /><Toaster /></>);
  const input = view.container.querySelector<HTMLInputElement>('input[accept=".json,.orbis-board.json"]')!;
  const file = new File(["{}"], "large.orbis-board.json", { type: "application/json" });
  Object.defineProperty(file, "size", { value: 32 * 1024 * 1024 + 1 });

  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("文件超过 32 MiB 导入限制。");
  act(() => heroToast.close(heroToast.getQueue().visibleToasts[0].key));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: "选中测试对象" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("文件超过 32 MiB 导入限制。");
});

it("keeps each page tab linked to the live canvas panel after keyboard switches", async () => {
  render(<BoardEditor id="board" />);
  const user = userEvent.setup();
  const first = screen.getByRole("tab", { name: "页面 1" });
  expect(screen.getByRole("tabpanel", { name: "页面 1" }).id).toBe(first.getAttribute("aria-controls"));
  await user.click(first);
  await user.keyboard("{ArrowRight}{Enter}");
  const second = screen.getByRole("tab", { name: "页面 2" });
  expect(second).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: "页面 2" }).id).toBe(second.getAttribute("aria-controls"));
  expect(screen.getByRole("application", { name: "画板编辑区域" })).toBeVisible();
  expect(screen.queryByRole("tabpanel", { name: "页面 1" })).toBeNull();
  await user.keyboard("{ArrowLeft}{Enter}");
  expect(screen.getByRole("tabpanel", { name: "页面 1" }).id).toBe(first.getAttribute("aria-controls"));
});

it("opens advanced settings only from an explicit action and closes them when the selection or page is cleared", async () => {
  render(<BoardEditor id="board" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "选中测试对象" }));
  expect(screen.queryByRole("complementary", { name: "画板属性" })).toBeNull();
  const settings = screen.getByRole("button", { name: "设置选中对象" });
  expect(settings).toHaveAttribute("aria-expanded", "false");
  await user.click(settings);
  const inspector = screen.getByRole("complementary", { name: "画板属性" });
  expect(inspector).toBeVisible();
  expect(settings).toHaveAttribute("aria-controls", inspector.id);
  expect(settings).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "关闭属性面板" }));
  await user.click(screen.getByRole("button", { name: "选中测试对象" }));
  expect(screen.queryByRole("complementary", { name: "画板属性" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "设置选中对象" }));
  await user.click(screen.getByRole("button", { name: "清除测试选择" }));
  expect(screen.queryByRole("complementary", { name: "画板属性" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "选中测试对象" }));
  await user.click(screen.getByRole("button", { name: "设置选中对象" }));
  await user.click(screen.getByRole("tab", { name: "页面 2" }));
  expect(screen.queryByRole("complementary", { name: "画板属性" })).toBeNull();
});

it("offers mind maps as a primary drawing tool with placement guidance", async () => {
  render(<BoardEditor id="board" />);
  const user = userEvent.setup();
  const mindmap = screen.getByRole("toolbar", { name: "画板工具" }).querySelector('[aria-label="思维导图"]')!;
  await user.click(mindmap);
  expect(mindmap).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("点击画布创建思维导图，Tab 添加子主题，Enter 添加同级主题。")).toBeVisible();
});
