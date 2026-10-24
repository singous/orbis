import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../src/shared/auth/auth-store";
import { listWorkspaces } from "../../src/features/workspace/api";
import { act } from "@testing-library/react";
import { AcceptInvitationPage } from "../../src/features/members/AcceptInvitationPage";
import { ConfirmOwnershipPage } from "../../src/features/members/ConfirmOwnershipPage";
import { acceptInvitation, confirmOwnershipTransfer, inspectInvitation } from "../../src/features/members/api";

vi.mock("../../src/features/members/api", () => ({ acceptInvitation: vi.fn(), confirmOwnershipTransfer: vi.fn(), inspectInvitation: vi.fn() }));
vi.mock("../../src/features/workspace/api", () => ({ listWorkspaces: vi.fn() }));
vi.mock("../../src/shared/auth/use-auth-request", () => ({ useOptionalAuthRequest: () => null }));
function Navigation({ prefix }: { prefix: string }) { const navigate = useNavigate(); return <button onClick={() => navigate(`/${prefix}/b`)}>打开 B</button>; }
function mount(prefix: string, page: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/${prefix}/a`]}><Navigation prefix={prefix} /><Routes><Route path={`/${prefix}/:token`} element={page} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.resetAllMocks(); authStore.getState().clearSession(); });
afterEach(() => { cleanup(); authStore.getState().clearSession(); });
it("resets ownership confirmation state for another transfer token", async () => {
  vi.mocked(confirmOwnershipTransfer).mockResolvedValue({} as Awaited<ReturnType<typeof confirmOwnershipTransfer>>);
  mount("ownership", <ConfirmOwnershipPage />);
  fireEvent.click(screen.getByRole("button", { name: "确认所有权转让" }));
  await screen.findByText("所有权已完成转让");
  fireEvent.click(screen.getByRole("button", { name: "打开 B" }));
  expect(screen.getByRole("button", { name: "确认所有权转让" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "确认所有权转让" }));
  await screen.findByText("所有权已完成转让");
  expect(vi.mocked(confirmOwnershipTransfer).mock.calls.map(call => call[0])).toEqual(["a", "b"]);
});
it("resets accepted invitation state for another invitation token", async () => {
  vi.mocked(inspectInvitation).mockImplementation(async token => ({ workspace_name: `工作空间 ${token}`, email: "invite@example.com", role: "editor", account_exists: false, expires_at_ms: 100 }));
  vi.mocked(acceptInvitation).mockResolvedValue({ session: null, user: {}, member: {} } as Awaited<ReturnType<typeof acceptInvitation>>);
  mount("invite", <AcceptInvitationPage />);
  await screen.findByText("工作空间：工作空间 a · invite@example.com");
  fireEvent.submit(screen.getByRole("button", { name: "确认加入" }).closest("form")!);
  await screen.findByText("已加入工作空间");
  fireEvent.click(screen.getByRole("button", { name: "打开 B" }));
  await screen.findByText("工作空间：工作空间 b · invite@example.com");
  expect(screen.getByRole("button", { name: "确认加入" })).toBeEnabled();
});

it("does not activate a completed invitation after its page was abandoned", async () => {
  let finish!: (value: Awaited<ReturnType<typeof acceptInvitation>>) => void;
  vi.mocked(inspectInvitation).mockImplementation(async token => ({ workspace_name: `工作空间 ${token}`, email: "invite@example.com", role: "editor", account_exists: false, expires_at_ms: 100 }));
  vi.mocked(acceptInvitation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(listWorkspaces).mockResolvedValue({ items: [] });
  mount("invite", <AcceptInvitationPage />);
  await screen.findByText("工作空间：工作空间 a · invite@example.com");
  fireEvent.submit(screen.getByRole("button", { name: "确认加入" }).closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "打开 B" }));
  await screen.findByText("工作空间：工作空间 b · invite@example.com");
  await act(async () => { finish({ session: { access_token: "old-access", refresh_token: "old-refresh" }, user: {}, member: {} } as Awaited<ReturnType<typeof acceptInvitation>>); });
  expect(authStore.getState().accessToken).toBeNull();
  expect(listWorkspaces).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "确认加入" })).toBeEnabled();
});
