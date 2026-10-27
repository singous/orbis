import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardEmbed } from "../../src/features/boards/BoardEmbed";
import { authStore } from "../../src/shared/auth/auth-store";

const mocks = vi.hoisted(() => ({ get: vi.fn(), preview: vi.fn() }));
vi.mock("../../src/features/boards/api", () => ({ boardAPI: () => ({ get: mocks.get }) }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({ useOptionalAuthRequest: () => ({ workspaceId: "workspace", accessToken: "test" }), authRequestOptions: () => ({}) }));
vi.mock("../../src/shared/api/api-client", () => ({ apiBlobRequest: mocks.preview, workspacePath: (_auth: unknown, path: string) => path }));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", undefined);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mocks.get.mockResolvedValue({ title: "设计图", document_id: "document" });
  mocks.preview.mockResolvedValue(new Blob(["<svg/>"]));
  authStore.setState({ workspace: { id: "workspace", name: "工作空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); authStore.getState().clearSession(); });

function show(mode: "live" | "snapshot", readOnly: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><BoardEmbed props={{ board_id: "board", page_id: "page", mode, revision: mode === "snapshot" ? 7 : null, frame_id: "frame" }} readOnly={readOnly} onBind={vi.fn()} /></MemoryRouter></QueryClientProvider>);
}

it("keeps a fixed snapshot on its stored revision and never offers inline editing", async () => {
  show("snapshot", false);
  await screen.findByRole("img", { name: "设计图" });
  expect(screen.queryByRole("button", { name: "编辑画板" })).toBeNull();
  expect(mocks.get).toHaveBeenCalledWith("board", 7, expect.any(AbortSignal));
  expect(mocks.preview.mock.calls[0][0]).toContain("revision=7&frame_id=frame");
  expect(screen.getByRole("link", { name: "打开画板" })).toHaveAttribute("href", "/documents/document?page=page");
});

it("keeps read-only document embeds viewable without offering mutation controls", async () => {
  show("live", true);
  await screen.findByRole("img", { name: "设计图" });
  expect(screen.getByRole("button", { name: "全屏展开" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "编辑画板" })).toBeNull();
  expect(screen.queryByRole("button", { name: "更换引用" })).toBeNull();
});

it("does not expose editing to workspace viewers even when the document host is editable", async () => {
  authStore.setState({ workspace: { id: "workspace", name: "工作空间", role: "viewer", created_at_ms: 1, updated_at_ms: 1 } });
  show("live", false);
  await waitFor(() => expect(mocks.get).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "编辑画板" })).toBeNull();
});
