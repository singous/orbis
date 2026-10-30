import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EmbeddedSurface } from "../../src/shared/ui/EmbeddedSurface";

afterEach(() => { cleanup(); sessionStorage.clear(); });

it("retains the same editor, draft and scroll position through full-screen round trips", async () => {
  const mounted = vi.fn(), unmounted = vi.fn();
  function Editor() {
    const [draft, setDraft] = useState("");
    useEffect(() => { mounted(); return unmounted; }, []);
    return <div data-testid="scroll"><input aria-label="草稿" value={draft} onChange={e => setDraft(e.target.value)} /></div>;
  }
  const user = userEvent.setup();
  render(<EmbeddedSurface label="测试数据表" kind="table" surfaceKey="test"><Editor /></EmbeddedSurface>);
  await user.type(screen.getByLabelText("草稿"), "未保存内容");
  const input = screen.getByLabelText("草稿");
  const scroll = screen.getByTestId("scroll");
  scroll.scrollTop = 150;
  await user.click(screen.getByRole("button", { name: "全屏展开" }));
  expect(screen.getByRole("button", { name: "返回文档" })).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  expect(screen.getByLabelText("草稿")).toBe(input);
  expect(input).toHaveValue("未保存内容");
  expect(scroll.scrollTop).toBe(150);
  await user.click(screen.getByRole("button", { name: "返回文档" }));
  expect(screen.getByRole("button", { name: "全屏展开" })).toHaveFocus();
  expect(input).toHaveValue("未保存内容");
  expect(mounted).toHaveBeenCalledOnce();
  expect(unmounted).not.toHaveBeenCalled();
  expect(document.body.style.overflow).toBe("");
});

it("leaves Escape to a nested editor and restores the document when the surface unmounts", async () => {
  const user = userEvent.setup();
  const view = render(<div id="root"><EmbeddedSurface label="画板" kind="board" surfaceKey="escape"><button onKeyDown={e => { if (e.key === "Escape") e.preventDefault(); }}>内部编辑</button></EmbeddedSurface></div>);
  await user.click(screen.getByRole("button", { name: "全屏展开" }));
  expect(document.querySelector<HTMLElement>("#root")!.inert).toBe(true);
  await user.click(screen.getByRole("button", { name: "内部编辑" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "返回文档" })).toBeInTheDocument();
  view.unmount();
  expect(document.body.style.overflow).toBe("");
  expect(screen.queryByRole("region", { name: "画板" })).not.toBeInTheDocument();
});

it("supports bounded keyboard resizing and resetting to the current content height", async () => {
  const user = userEvent.setup();
  render(<EmbeddedSurface label="表格" kind="table" surfaceKey="resize" defaultHeight={300}><p>内容</p></EmbeddedSurface>);
  const handle = screen.getByRole("separator", { name: "调整嵌入高度" });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(handle).toHaveAttribute("aria-valuenow", "340");
  for (let i = 0; i < 30; i++) fireEvent.keyDown(handle, { key: "ArrowUp" });
  expect(handle).toHaveAttribute("aria-valuenow", "220");
  await user.click(screen.getByRole("button", { name: "恢复默认高度" }));
  expect(handle).toHaveAttribute("aria-valuenow", "300");
  expect(sessionStorage.getItem("orbis.embed-height:resize")).toBeNull();
});

it("isolates grid clipboard and keyboard events from the surrounding document editor", () => {
  const key = vi.fn(), paste = vi.fn();
  render(<div onKeyDown={key} onPaste={paste}><EmbeddedSurface kind="table" label="数据表" surfaceKey="events"><input aria-label="单元格" /></EmbeddedSurface></div>);
  fireEvent.keyDown(screen.getByLabelText("单元格"), { key: "Backspace" });
  fireEvent.paste(screen.getByLabelText("单元格"));
  expect(key).not.toHaveBeenCalled();
  expect(paste).not.toHaveBeenCalled();
});
