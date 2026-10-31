import { Toaster } from "../../src/shared/ui/Toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/shared/api/api-client";
import { PublicSheetForm } from "../../src/features/sheets/PublicSheetForm";
import { readPublicForm, submitPublicForm } from "../../src/features/sheets/api";
import { newField } from "../../src/features/sheets/model";

vi.mock("../../src/features/sheets/api", () => ({
  readPublicForm: vi.fn(), submitPublicForm: vi.fn(), uploadPublicFormFile: vi.fn(),
}));
vi.mock("../../src/shared/ui/ActionButton", () => ({ ActionButton: ({ size: _size, variant: _variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => <button {...props} /> }));
const field = { ...newField("text"), id: "answer", name: "回答" };
const form = (token: string) => ({ id: token, version: token === "a" ? 1 : 2, config: { title: `表单 ${token}`, description: "", fields: [{ field_id: "answer", required: true, description: "" }] }, fields: [field] });
function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate("/forms/b")}>打开 B</button>; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/forms/a"]}><Navigation /><Routes><Route path="/forms/:token" element={<PublicSheetForm />} /></Routes></MemoryRouter><Toaster /></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); vi.mocked(readPublicForm).mockImplementation(async token => form(token)); });
afterEach(cleanup);

describe("public sheet submission sessions", () => {
  it("starts a clean form session after navigating away from an uncertain submission", async () => {
    vi.mocked(submitPublicForm).mockRejectedValue(new ApiError(503, "服务暂时不可用"));
    mount();
    await screen.findByText("表单 a");
    fireEvent.change(screen.getByRole("textbox", { name: "回答" }), { target: { value: "A 的私人回答" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await screen.findByText("服务暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "打开 B" }));
    await screen.findByText("表单 b");
    expect(screen.getByRole("textbox", { name: "回答" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "提交" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: "回答" }), { target: { value: "B 的回答" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await waitFor(() => expect(submitPublicForm).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitPublicForm).mock.calls[1]).toEqual(["b", expect.objectContaining({ version: 2, values: { answer: "B 的回答" } })]);
    expect(vi.mocked(submitPublicForm).mock.calls[1][1]).not.toEqual(vi.mocked(submitPublicForm).mock.calls[0][1]);
    expect(sessionStorage.getItem("orbis.sheet-submission:a")).toContain("A 的私人回答");
  });
  it("does not carry the success screen to another form token", async () => {
    vi.mocked(submitPublicForm).mockResolvedValue({});
    mount();
    await screen.findByText("表单 a");
    fireEvent.change(screen.getByRole("textbox", { name: "回答" }), { target: { value: "已提交" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await screen.findByText("提交成功");
    fireEvent.click(screen.getByRole("button", { name: "打开 B" }));
    await screen.findByText("表单 b");
    expect(screen.queryByText("提交成功")).not.toBeInTheDocument();
  });
  it.each([408, 429])("retries the same operation after an uncertain HTTP %s response", async status => {
    vi.mocked(submitPublicForm).mockRejectedValueOnce(new ApiError(status, "请稍后重试")).mockResolvedValueOnce({});
    mount();
    await screen.findByText("表单 a");
    fireEvent.change(screen.getByRole("textbox", { name: "回答" }), { target: { value: "只保存一次" } });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await screen.findByText("请稍后重试");
    fireEvent.click(screen.getByRole("button", { name: "重试提交" }));
    await screen.findByText("提交成功");
    expect(vi.mocked(submitPublicForm).mock.calls[1]).toEqual(vi.mocked(submitPublicForm).mock.calls[0]);
  });
});
