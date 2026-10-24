import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { BoardEmbed } from "../../src/features/boards/BoardEmbed";
import type { Board } from "../../src/features/boards/model";

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock("../../src/features/boards/api", () => ({ boardAPI: () => mocks }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({
  useOptionalAuthRequest: () => ({ workspaceId: "workspace", accessToken: "test" }),
  authRequestOptions: () => ({}),
}));
const board = (id: string) => ({ id, title: id, revision: 1, pages: [{ id: `${id}-page`, name: "首页" }] }) as Board;
const clients: QueryClient[] = [];

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const onBind = vi.fn();
  render(<QueryClientProvider client={client}><MemoryRouter><BoardEmbed props={{}} readOnly={false} onBind={onBind} /></MemoryRouter></QueryClientProvider>);
  return onBind;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue({ items: [board("A"), board("B")], pagination: { page: 1, page_size: 20, total: 2 } });
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; });

it("does not fetch the board picker until it is opened", async () => {
  show();
  expect(mocks.list).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "选择画板" }));
  expect(await screen.findByRole("button", { name: "A" })).toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledOnce();
});

it("retains the most recently chosen board when the previous response arrives late", async () => {
  let resolveA!: (value: Board) => void;
  let resolveB!: (value: Board) => void;
  mocks.get.mockImplementation((id: string) => new Promise(resolve => {
    if (id === "A") resolveA = resolve; else resolveB = resolve;
  }));
  const onBind = show();
  await userEvent.click(screen.getByRole("button", { name: "选择画板" }));
  await userEvent.click(await screen.findByRole("button", { name: "A" }));
  await userEvent.click(screen.getByRole("button", { name: "B" }));
  expect(mocks.get.mock.calls[0][2].aborted).toBe(true);
  await act(async () => resolveB(board("B")));
  await act(async () => resolveA(board("A")));
  await userEvent.click(screen.getByRole("button", { name: "插入画板" }));
  expect(onBind).toHaveBeenCalledWith(expect.objectContaining({ board_id: "B", page_id: "B-page" }));
});

it("cancels a pending choice on close and starts a fresh picker session when reopened", async () => {
  let resolve!: (value: Board) => void;
  mocks.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  show();
  await userEvent.click(screen.getByRole("button", { name: "选择画板" }));
  await userEvent.click(await screen.findByRole("button", { name: "A" }));
  await userEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(mocks.get.mock.calls[0][2].aborted).toBe(true));
  await act(async () => resolve(board("A")));
  await userEvent.click(screen.getByRole("button", { name: "选择画板" }));
  expect(await screen.findByRole("button", { name: "A" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "插入画板" })).not.toBeInTheDocument();
});

it("preserves the chosen page and snapshot revision through shared selection controls", async () => {
  mocks.get.mockResolvedValue({ ...board("B"), pages: [{ id: "B-page", name: "首页" }, { id: "B-details", name: "细节页" }] });
  const onBind = show();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "选择画板" }));
  await user.click(await screen.findByRole("button", { name: "B" }));
  await user.click(await screen.findByRole("button", { name: /引用页面/ }));
  await user.click(screen.getByRole("option", { name: "细节页" }));
  await user.click(screen.getByRole("button", { name: /引用方式/ }));
  await user.click(screen.getByRole("option", { name: "固定快照" }));
  await user.click(screen.getByRole("button", { name: "插入画板" }));
  expect(onBind).toHaveBeenCalledWith({ board_id: "B", page_id: "B-details", mode: "snapshot", revision: 1, frame_id: null });
});
