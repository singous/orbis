import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers";
import { apiRequest } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { RequireAuth } from "../../shared/auth/RequireAuth";
import { session } from "../collaboration/collaboration.test-utils";
import { RailCreateMenu } from "./RailCreateMenu";
import { WorkspaceAccountMenu } from "./WorkspaceAccountMenu";
vi.mock("../documents/queries", () => ({
  useCreateNote: () => ({ isPending: false, mutateAsync: () => apiRequest("/v1/documents/test", { method: "POST" }) }),
  useCreateNotebook: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDocumentGroups: () => ({ data: { items: [] } }),
  useNotebooks: () => ({ data: { items: [{ id: "notebook", updated_at_ms: 1 }] }, isLoading: false, isError: false }),
  useNoteTree: () => ({ data: { items: [] }, isSuccess: true }),
}));
function failure(message: string) { return new Response(JSON.stringify({ code: "REQUEST_FAILED", message, request_id: "feedback", data: null }), { status: 503, headers: { "Content-Type": "application/json" } }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); authStore.getState().clearSession(); });
it("shows one backend message for a failed rail document creation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => failure("文档额度不足")));
  render(<MemoryRouter><AppProviders><RailCreateMenu /></AppProviders></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新建资产" }));
  await user.click(screen.getByRole("button", { name: /^文档$/ }));
  expect(await screen.findByRole("alertdialog", { name: "文档额度不足" })).toBeVisible();
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(screen.queryByText("文档创建失败，请重试")).not.toBeInTheDocument();
});
it("keeps a single backend failure toast visible after local sign-out clears the old session", async () => {
  act(() => authStore.getState().setSession(session));
  vi.stubGlobal("fetch", vi.fn(async () => failure("服务端暂不能撤销会话")));
  render(<MemoryRouter><AppProviders><Routes><Route path="/" element={<RequireAuth><WorkspaceAccountMenu /></RequireAuth>} /><Route path="/login" element={<h1>登录页面</h1>} /></Routes></AppProviders></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开用户菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
  await screen.findByRole("heading", { name: "登录页面" });
  expect(authStore.getState().accessToken).toBeNull();
  expect(await screen.findByRole("alertdialog", { name: "服务端暂不能撤销会话" })).toBeVisible();
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
});
