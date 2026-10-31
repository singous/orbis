import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EmbeddedSurface } from "../../src/shared/ui/EmbeddedSurface";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });


it("keeps board heights only in memory and never reads or writes browser storage", async () => {
  const read = vi.spyOn(sessionStorage, "getItem");
  const write = vi.spyOn(sessionStorage, "setItem");
  const user = userEvent.setup();
  const view = render(<EmbeddedSurface label="画板" kind="board" surfaceKey="board-height" defaultHeight={400}><p>内容</p></EmbeddedSurface>);
  const handle = screen.getByRole("separator", { name: "调整嵌入高度" });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(handle).toHaveAttribute("aria-valuenow", "440");
  await user.click(screen.getByRole("button", { name: "恢复默认高度" }));
  expect(handle).toHaveAttribute("aria-valuenow", "400");
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  view.unmount();
  read.mockRestore(); write.mockRestore();
});
