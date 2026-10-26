import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { BoardPreviewViewport } from "../../src/features/boards/BoardPreviewViewport";
afterEach(cleanup);

it("zooms, pans with the keyboard and restores the complete board", async () => {
  const user = userEvent.setup();
  const { container } = render(<BoardPreviewViewport><img alt="流程图" src="/preview.svg" /></BoardPreviewViewport>);
  await user.click(screen.getByRole("button", { name: "放大画板" }));
  expect(screen.getByRole("button", { name: "缩放比例 120%" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowLeft" });
  expect(container.querySelector(".board-preview-transform")).toHaveStyle({ transform: "translate(40px, 0px) scale(1.2)" });
  await user.click(screen.getByRole("button", { name: "适应画布" }));
  expect(container.querySelector(".board-preview-transform")).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
  await user.click(screen.getByRole("button", { name: "缩放比例 100%" }));
  await user.click(screen.getByRole("menuitemradio", { name: "200%" }));
  expect(screen.getByRole("button", { name: "缩放比例 200%" })).toBeInTheDocument();
});
