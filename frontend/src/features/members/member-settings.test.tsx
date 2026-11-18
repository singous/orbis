import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import { WorkspaceLayoutContext } from "../workspace/workspace-layout-context";
import { MemberSettingsPage } from "./MemberSettingsPage";

const workspaceId = "00000000-0000-4000-8000-000000000002";
const member = { workspace_id: workspaceId, user_id: "00000000-0000-4000-8000-000000000003", email: "member@example.com", display_name: "成员", role: "editor", version: 7, created_at_ms: 1, updated_at_ms: 1 };
const fetchMock = vi.fn<typeof fetch>();
const envelope = (data: unknown) => Response.json({ code: "OK", message: "", request_id: "member-ui-test", data });
const page = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><WorkspaceLayoutContext.Provider value={{ configure: () => {}, release: () => {} }}><MemberSettingsPage /></WorkspaceLayoutContext.Provider></QueryClientProvider>);
}
beforeEach(() => {
  authStore.getState().setSession({ accessToken: "test-access", refreshToken: "test-refresh", user: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", display_name: "所有者", bio: null, avatar_asset_id: null, preferred_workspace_id: null, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 }, workspace: { id: workspaceId, name: "测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.endsWith("/members")) return envelope(page([member]));
    if (path.endsWith("/invitations")) return envelope(page([]));
    if (path.endsWith("/mail-status")) return envelope({ enabled: true });
    if (path.endsWith("/ownership-transfers/current")) return Response.json({ code: "NOT_FOUND", message: "无转让", request_id: "test", data: null }, { status: 404 });
    if (path.endsWith(`/members/${member.user_id}`) && init?.method === "PATCH") return envelope({ ...member, role: "viewer", version: 8 });
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); vi.unstubAllGlobals(); });

it("sends the selected member role with the existing concurrency version", async () => {
  const user = userEvent.setup();
  mount();
  const select = await screen.findByRole("combobox", { name: `调整 ${member.email} 的角色` });
  await user.click(select);
  await user.click(await screen.findByRole("option", { name: "只读成员" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/v1/workspaces/${workspaceId}/members/${member.user_id}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "viewer", expected_version: 7 }) })));
});

it("keeps management actions unavailable to read-only members", async () => {
  authStore.setState(state => ({ workspace: { ...state.workspace!, role: "viewer" } }));
  mount();
  await screen.findByText(member.email);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: `移除 ${member.email}` })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "发送邀请" })).not.toBeInTheDocument();
});

it("retains the server role and retries with the same version after a failed update", async () => {
  const initialRequest = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => init?.method === "PATCH"
    ? Promise.resolve(Response.json({ code: "VERSION_CONFLICT", message: "成员已被更新", request_id: "test", data: null }, { status: 409 }))
    : initialRequest(input, init));
  const user = userEvent.setup();
  mount();
  const select = await screen.findByRole("combobox", { name: `调整 ${member.email} 的角色` });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "只读成员" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(attempt));
    await waitFor(() => expect(select).toBeEnabled());
    expect(select).toHaveTextContent("编辑者");
  }
  const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
  expect(writes.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { role: "viewer", expected_version: 7 },
    { role: "viewer", expected_version: 7 },
  ]);
});
