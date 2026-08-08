import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "../../app/LoginPage";
import { ApiError } from "../../shared/api/api-client";

const loginMock = vi.fn();
const setupMock = vi.fn();

vi.mock("../../shared/auth/auth-api", () => ({
  login: (...args: unknown[]) => loginMock(...args),
  setup: (...args: unknown[]) => setupMock(...args),
}));

function renderPage(mode: "login" | "setup") {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><LoginPage mode={mode} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("community auth flow", () => {
  beforeEach(() => {
    loginMock.mockReset();
    setupMock.mockReset();
  });

  it("defaults to login and exposes setup without public registration", () => {
    renderPage("login");
    expect(screen.getByRole("heading", { name: "登录工作空间" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /初始化管理员账号/ })).toHaveAttribute("href", "/setup");
    expect(screen.queryByText(/注册账号/)).not.toBeInTheDocument();
  });

  it("guides repeated setup attempts back to login", async () => {
    setupMock.mockRejectedValue(new ApiError(409, "System is already initialized"));
    renderPage("setup");
    await userEvent.type(screen.getByLabelText("显示名称"), "Owner");
    await userEvent.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "创建并进入工作空间" }));
    expect(await screen.findByText("无需重复初始化")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "返回登录" })[0]).toHaveAttribute("href", "/login");
  });
});
