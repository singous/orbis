import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotebookDirectoryColumn } from "../../src/features/documents/NotebookDirectoryColumn";

afterEach(() => { cleanup(); localStorage.removeItem("orbis.notebookDirectoryWidth"); });
it("retains the tree while collapsed and supports keyboard resizing", () => {
  const toggle = vi.fn();
  const view = render(<NotebookDirectoryColumn collapsed={false} onToggle={toggle}><nav aria-label="测试目录">当前文档</nav></NotebookDirectoryColumn>);
  const resize = screen.getByRole("separator", { name: "调整笔记本目录宽度" });
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(localStorage.getItem("orbis.notebookDirectoryWidth")).toBe("276");
  fireEvent.click(screen.getByRole("button", { name: "收起笔记本目录" }));
  expect(toggle).toHaveBeenCalledOnce();
  view.rerender(<NotebookDirectoryColumn collapsed onToggle={toggle}><nav aria-label="测试目录">当前文档</nav></NotebookDirectoryColumn>);
  expect(screen.queryByRole("navigation", { name: "测试目录" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "测试目录", hidden: true })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "展开笔记本目录" })).toBeNull();
});
