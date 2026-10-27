import { toast as heroToast } from "@heroui/react/toast";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { Toaster } from "../../shared/ui/Toast";
import type { Board } from "./model";
import type { SessionState } from "./session";
import { BoardEditor } from "./BoardEditor";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";

const sessionControl = vi.hoisted(() => ({
  initial: {} as Partial<SessionState>,
  current: null as { publish: (update: Partial<SessionState>) => void } | null,
  retry: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("../../shared/auth/use-auth-request", () => ({ useAuthRequest: () => ({ workspaceId: "workspace", accessToken: "test" }) }));
vi.mock("../sharing/ShareButton", () => ({ ShareButton: () => <button>分享</button> }));
vi.mock("./BoardShell", () => ({ BoardShell: ({ children, status }: { children: React.ReactNode; status: React.ReactNode }) => <main>{status}{children}</main> }));
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
      elements: new Map([["sample", { ...makeElement("flow.process", "first", 0, 0), id: "sample" }]]), pageID: "first", status: "saved", error: null, pending: 0, canUndo: false, canRedo: false, canDiscard: false,
    };
    constructor() { this.state = { ...this.state, ...sessionControl.initial }; sessionControl.current = this; }
    publish = (update: Partial<SessionState>) => {
      this.state = { ...this.state, ...update };
      for (const listener of this.listeners) listener();
    };
    retry = sessionControl.retry;
    discardPending = sessionControl.discard;
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
  sessionControl.initial = {};
  sessionControl.current = null;
  sessionControl.retry.mockReset();
  sessionControl.discard.mockReset();
  authStore.setState({ workspace: { id: "workspace", name: "验收空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); heroToast.clear(); authStore.getState().clearSession(); });

it("only offers discard when the session can safely discard its pending operations", async () => {
  sessionControl.initial = { status: "conflict", pending: 1, error: "保存结果尚未确认", canDiscard: false };
  render(<><BoardEditor id="board" /><Toaster /></>);
  expect(await screen.findByRole("button", { name: "重试保存" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "放弃未保存修改" })).not.toBeInTheDocument();
  act(() => sessionControl.current!.publish({ canDiscard: true }));
  expect(await screen.findByRole("button", { name: "放弃未保存修改" })).toBeEnabled();
});

it("preserves the server reason after discard fails and clears recovery feedback when retry succeeds", async () => {
  sessionControl.initial = { status: "conflict", pending: 1, error: "服务器拒绝：图元尺寸无效", canDiscard: true };
  sessionControl.discard.mockRejectedValue(new Error("重新读取服务器失败"));
  sessionControl.retry.mockImplementation(async () => {
    sessionControl.current!.publish({ status: "saved", pending: 0, error: null, canDiscard: false });
  });
  render(<><BoardEditor id="board" /><Toaster /></>);
  fireEvent.click(await screen.findByRole("button", { name: "放弃未保存修改" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃并重新读取" }));
  await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent("重新读取服务器失败"));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("服务器拒绝：图元尺寸无效");
  fireEvent.click(screen.getByRole("button", { name: "继续保留" }));
  fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

it("clears failed discard feedback when background synchronization resolves the operation", async () => {
  sessionControl.initial = { status: "conflict", pending: 1, error: "保存失败", canDiscard: true };
  sessionControl.discard.mockRejectedValue(new Error("正在确认操作结果"));
  render(<><BoardEditor id="board" /><Toaster /></>);
  fireEvent.click(await screen.findByRole("button", { name: "放弃未保存修改" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃并重新读取" }));
  await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent("正在确认操作结果"));
  act(() => sessionControl.current!.publish({ status: "saved", pending: 0, error: null, canDiscard: false }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "放弃并重新读取" })).not.toBeInTheDocument();
});

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


it("keeps retry available after dismissing the error and prevents guarded navigation from dropping an unsaved edit", async () => {
  sessionControl.initial = { status: "save_failed", pending: 1, error: "连接失败", canDiscard: false };
  const view = render(<><BoardEditor id="board" /><Toaster /></>);
  const notice = await screen.findByRole("alertdialog");
  fireEvent.click(notice.querySelector('button[aria-label="Close"]')!);
  expect(screen.getByRole("button", { name: "重试保存" })).toBeVisible();
  await expect(preparePendingNavigation()).rejects.toThrow("画板尚未保存");
  expect(sessionControl.retry).not.toHaveBeenCalled();
  act(() => sessionControl.current!.publish({ pending: 0, status: "saved", error: null }));
  await expect(preparePendingNavigation()).resolves.toBeUndefined();
  view.unmount();
  await expect(preparePendingNavigation()).resolves.toBeUndefined();
});
