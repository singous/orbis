import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast as heroToast } from "@heroui/react/toast";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "../../app/LoginPage";
import { ApiError } from "../../shared/api/api-client";
import { Toaster } from "../../shared/ui/Toast";

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
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("community auth flow", () => {
  beforeEach(() => {
    loginMock.mockReset();
    setupMock.mockReset();
  });

  afterEach(() => {
    act(() => heroToast.clear());
  });

  it("defaults to login and exposes setup without public registration", () => {
    renderPage("login");
    expect(screen.getByRole("heading", { name: "欢迎回到 Orbis" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "欢迎回到 Orbis" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /初始化管理员账号/ })).toHaveAttribute("href", "/setup");
    expect(screen.queryByText(/注册账号/)).not.toBeInTheDocument();
  });

  it("guides repeated setup attempts back to login", async () => {
    setupMock.mockRejectedValue(new ApiError(409, "系统已经完成初始化", "SETUP_COMPLETED"));
    renderPage("setup");
    await userEvent.type(screen.getByLabelText("显示名称"), "Owner");
    await userEvent.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "correct horse battery staple");
    await userEvent.click(screen.getByRole("button", { name: "创建并进入工作空间" }));
    expect(await screen.findByText("系统已经完成初始化")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "返回登录" })[0]).toHaveAttribute("href", "/login");
  });

  it("shows the backend validation message without shifting the form", async () => {
    loginMock.mockRejectedValue(new ApiError(422, "请求字段校验失败", "VALIDATION_ERROR", "", {
      errors: [{ field: "body.email", code: "VALUE_ERROR", message: "字段值不正确" }],
    }));
    renderPage("login");
    await userEvent.type(screen.getByLabelText("邮箱"), "dev@orbis.local");
    await userEvent.type(screen.getByLabelText("密码"), "OrbisDev123!");
    await userEvent.click(screen.getByRole("button", { name: "登录 Orbis" }));

    expect(await screen.findByText("请求字段校验失败")).toBeInTheDocument();
    expect(screen.queryByText(/密码至少需要 8 位/)).not.toBeInTheDocument();
    expect(screen.queryByText("无法继续")).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "欢迎回到 Orbis" })).not.toHaveTextContent("邮箱格式不正确");
  });

  it("does not claim a password length requirement for an unknown login validation error", async () => {
    loginMock.mockRejectedValue(new ApiError(422, "请求字段校验失败", "VALIDATION_ERROR", "", {
      errors: [{ field: "body.other", code: "VALUE_ERROR", message: "字段值不正确" }],
    }));
    renderPage("login");
    await userEvent.type(screen.getByLabelText("邮箱"), "dev@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "OrbisDev123!");
    await userEvent.click(screen.getByRole("button", { name: "登录 Orbis" }));

    expect(await screen.findByText("请求字段校验失败")).toBeInTheDocument();
    expect(screen.queryByText(/密码至少需要 8 位/)).not.toBeInTheDocument();
  });

  it("allows a short nonempty login password through to the API", async () => {
    loginMock.mockRejectedValue(new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS"));
    renderPage("login");
    await userEvent.type(screen.getByLabelText("邮箱"), "dev@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "short");
    await userEvent.click(screen.getByRole("button", { name: "登录 Orbis" }));

    expect(loginMock).toHaveBeenCalledWith({ email: "dev@example.com", password: "short" });
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(screen.queryByText(/至少需要 8 位/)).not.toBeInTheDocument();
  });

  it("enforces the eight character requirement only during initial setup", async () => {
    renderPage("setup");
    await userEvent.type(screen.getByLabelText("显示名称"), "Owner");
    await userEvent.type(screen.getByLabelText("邮箱"), "owner@example.com");
    await userEvent.type(screen.getByLabelText("密码"), "short");
    await userEvent.click(screen.getByRole("button", { name: "创建并进入工作空间" }));

    expect(setupMock).not.toHaveBeenCalled();
    expect(await screen.findByText("密码需要 12 至 128 字节。")).toBeInTheDocument();
  });
});
