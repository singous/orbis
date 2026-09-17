import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotebookDialog } from "../../src/features/documents/NotebookDialog";
import { NotebookIcon } from "../../src/features/documents/NotebookIcon";
import { authStore } from "../../src/shared/auth/auth-store";

const fileId = "018ff7c4-a5b6-7000-8000-000000000040";
const dataUrl = "data:image/webp;base64,aWNvbg==";

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: status === 200 ? "OK" : "ERROR", message: "图标上传失败，请重试", request_id: "icon-test", data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function openDialog(onSubmit = vi.fn()) {
  return { onSubmit, ...render(<NotebookDialog open onClose={vi.fn()} onSubmit={onSubmit} />) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => authStore.getState().clearSession());
});

describe("notebook icons", () => {
  it("renders existing notebooks with a blue book without requiring a query provider", () => {
    const { container } = render(<NotebookIcon />);
    expect(container.querySelector(".notebook-icon--blue")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("loads custom images with authentication and keeps a visible fallback if the image fails", async () => {
    authStore.setState({ accessToken: "image-token" });
    const fetchMock = vi.fn().mockResolvedValue(envelope({ data_url: dataUrl }));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={queryClient}><NotebookIcon icon={{ type: "image", file_id: fileId }} /></QueryClientProvider>);
    expect(container.querySelector(".notebook-icon--blue")).toBeInTheDocument();
    const image = await screen.findByAltText("自定义笔记本图标");
    expect(image).toHaveAttribute("src", dataUrl);
    expect(fetchMock).toHaveBeenCalledWith(`/api/notebooks/icons/${fileId}`, expect.objectContaining({ headers: { Authorization: "Bearer image-token" } }));
    fireEvent.error(image);
    expect(container.querySelector(".notebook-icon--blue")).toBeInTheDocument();
    queryClient.clear();
  });

  it("submits a selected preset and color with the trimmed title", async () => {
    const user = userEvent.setup();
    const { onSubmit } = openDialog();
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "  产品想法  ");
    await user.click(screen.getByRole("radio", { name: "灵感" }));
    await user.click(screen.getByRole("radio", { name: "琥珀黄" }));
    expect(screen.getByRole("radio", { name: "灵感" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(onSubmit).toHaveBeenCalledWith({ title: "产品想法", icon: { type: "preset", name: "lightbulb", color: "amber" } });
  });

  it("lets keyboard users choose icons and colors with radio-group navigation", async () => {
    const user = userEvent.setup();
    const { onSubmit } = openDialog();
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "音乐灵感");
    await user.click(screen.getByRole("radio", { name: "灵感" }));
    await user.keyboard("[ArrowRight]");
    expect(screen.getByRole("radio", { name: "代码" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "代码" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("[Home]");
    expect(screen.getByRole("radio", { name: "书本" })).toHaveFocus();
    await user.keyboard("[End]");
    expect(screen.getByRole("radio", { name: "音乐" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("radio", { name: "湖蓝色" })).toHaveFocus();
    await user.keyboard("[ArrowRight]");
    expect(screen.getByRole("radio", { name: "薄荷绿" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(onSubmit).toHaveBeenCalledWith({ title: "音乐灵感", icon: { type: "preset", name: "music", color: "mint" } });
  });

  it("can reset an existing icon and starts fresh after reopening", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const props = { onClose: vi.fn(), onSubmit, initialValue: "研发", initialIcon: { type: "preset" as const, name: "code" as const, color: "violet" as const } };
    const view = render(<NotebookDialog open {...props} />);
    await user.click(screen.getByRole("button", { name: "恢复默认图标" }));
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(onSubmit).toHaveBeenCalledWith({ title: "研发", icon: null });
    view.rerender(<NotebookDialog open={false} {...props} />);
    view.rerender(<NotebookDialog open {...props} />);
    expect(screen.getByRole("radio", { name: "代码" })).toHaveAttribute("aria-checked", "true");
  });

  it("blocks submission during upload and saves the server file id after previewing", async () => {
    const user = userEvent.setup();
    authStore.setState({ accessToken: "icon-access-token" });
    let resolveUpload: (response: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveUpload = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { onSubmit } = openDialog();
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "视觉规范");
    const file = new File(["image"], "brand.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("上传自定义图标"), file);
    expect(screen.getByRole("button", { name: "上传中…" })).toBeDisabled();
    await act(async () => resolveUpload(envelope({ file_id: fileId, data_url: dataUrl })));
    expect(await screen.findByAltText("自定义笔记本图标")).toHaveAttribute("src", dataUrl);
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(onSubmit).toHaveBeenCalledWith({ title: "视觉规范", icon: { type: "image", file_id: fileId } });
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/notebooks/icons");
    expect(options.headers.Authorization).toBe("Bearer icon-access-token");
    expect(options.body.get("file")).toBe(file);
    expect(options.headers["Content-Type"]).toBeUndefined();
  });

  it("rejects oversized and unsupported files without uploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    openDialog();
    const input = screen.getByLabelText("上传自定义图标");
    fireEvent.change(input, { target: { files: [new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("PNG、JPEG 或 WebP");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("2 MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the selected preset after upload failure and shows save errors inline", async () => {
    const user = userEvent.setup();
    authStore.setState({ accessToken: "icon-access-token" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(null, 422)));
    const onSubmit = vi.fn().mockRejectedValue(new Error("笔记本名称已存在"));
    openDialog(onSubmit);
    await user.type(screen.getByRole("textbox", { name: "笔记本名称" }), "测试");
    await user.click(screen.getByRole("radio", { name: "火箭" }));
    await user.upload(screen.getByLabelText("上传自定义图标"), new File(["image"], "icon.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("图标上传失败");
    expect(screen.getByRole("radio", { name: "火箭" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("笔记本名称已存在"))).toBe(true));
  });
});
