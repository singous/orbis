import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { BoardEmbed } from "../../src/features/boards/BoardEmbed";
import { TableHostContext } from "../../src/features/data-tables/context";
import { authStore } from "../../src/shared/auth/auth-store";
import { releaseFeatures } from "../../src/shared/release-features";

const mocks = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), list: vi.fn(), owner: vi.fn(), preview: vi.fn() }));
vi.mock("../../src/features/boards/api", () => ({ boardAPI: () => mocks }));
vi.mock("../../src/features/documents/api", () => ({ getNote: (...args: unknown[]) => mocks.owner(...args) }));
vi.mock("../../src/shared/api/request-feedback", () => ({ reportError: vi.fn() }));
vi.mock("../../src/shared/api/api-client", () => ({ apiBlobRequest: (...args: unknown[]) => mocks.preview(...args), workspacePath: (_auth: unknown, path: string) => path }));
vi.mock("../../src/features/boards/BoardEditor", () => ({ BoardEditor: () => <div>画板编辑器</div> }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({ useOptionalAuthRequest: () => ({ workspaceId: "workspace", accessToken: "test" }), authRequestOptions: () => ({}) }));
const block = "018ff7c4-a5b6-7000-8000-000000000001";
const board = { id: block, title: "新画板", document_id: block, revision: 5, pages: [{ id: block, name: "首页" }] };
const clients: QueryClient[] = [];
function show(props: Record<string, unknown> = {}, readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const onBind = vi.fn();
  const view = render(<QueryClientProvider client={client}><MemoryRouter><TableHostContext.Provider value={{ noteId: "document", draftScope: "scope", auth: null, readOnly }}><BoardEmbed blockId={block} props={props} readOnly={readOnly} onBind={onBind} /></TableHostContext.Provider></MemoryRouter></QueryClientProvider>);
  return { ...view, onBind };
}
beforeEach(() => {
  releaseFeatures.boardCreation = true;
  vi.resetAllMocks();
  authStore.setState({ credentialID: "credential", workspace: { id: "workspace", name: "Workspace", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
  mocks.owner.mockResolvedValue({ id: "document", collection_id: "collection" });
  mocks.create.mockResolvedValue(board);
  mocks.get.mockResolvedValue(board);
  mocks.preview.mockResolvedValue(new Blob(["<svg/>"]));
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); authStore.getState().clearSession(); vi.unstubAllGlobals(); releaseFeatures.boardCreation = false; });

it("keeps blank blocks without creating boards while creation is deferred", async () => {
  releaseFeatures.boardCreation = false;
  const view = show();
  expect(await screen.findByText("画板创建将在后续版本开放。")).toBeInTheDocument();
  expect(mocks.owner).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(view.onBind).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "重试创建画板" })).not.toBeInTheDocument();
});

it("creates the block's own board without listing or selecting existing boards", async () => {
  const view = show();
  await waitFor(() => expect(view.onBind).toHaveBeenCalledWith({ board_id: block, page_id: block, mode: "live", revision: null, frame_id: null }));
  expect(mocks.create).toHaveBeenCalledWith({ id: block, operation_id: block, page_id: block, collection_id: "collection", parent_id: "document", title: "未命名画板", elements: [] });
  expect(mocks.list).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /选择画板|更换引用|引用已有/ })).not.toBeInTheDocument();
});
it("reuses the original creation input when retrying and remounting", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Response lost"));
  const first = show();
  await userEvent.click(await screen.findByRole("button", { name: "重试创建画板" }));
  await waitFor(() => expect(first.onBind).toHaveBeenCalledOnce());
  first.unmount();
  const second = show();
  await waitFor(() => expect(second.onBind).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls.map(call => call[0])).toEqual(Array(3).fill(mocks.create.mock.calls[0][0]));
});
it("does not bind a creation response after the block is removed", async () => {
  let resolve!: (value: typeof board) => void;
  mocks.create.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = show();
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => resolve(board));
  expect(view.onBind).not.toHaveBeenCalled();
});
it("does not create a resource for a read-only blank block", async () => {
  show({}, true);
  expect(await screen.findByText("尚未创建画板")).toBeInTheDocument();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("keeps legacy snapshot bindings readable without exposing a replacement picker", async () => {
  releaseFeatures.boardCreation = false;
  const view = show({ board_id: "legacy", page_id: block, mode: "snapshot", revision: 5, frame_id: "frame" });
  expect(await screen.findByText("快照 · v5")).toBeInTheDocument();
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("legacy", 5, expect.any(AbortSignal)));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(view.onBind).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /选择画板|更换引用|引用已有/ })).not.toBeInTheDocument();
});
