import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  await user.click(await screen.findByRole("menuitemradio", { name: "200%" }));
  expect(screen.getByRole("button", { name: "缩放比例 200%" })).toBeInTheDocument();
});

it("opens zoom choices with the keyboard, preserves selection and restores trigger focus", async () => {
  const user = userEvent.setup();
  render(<BoardPreviewViewport><img alt="流程图" src="/preview.svg" /></BoardPreviewViewport>);
  const trigger = screen.getByRole("button", { name: "缩放比例 100%" });
  act(() => trigger.focus());
  await user.keyboard("{ArrowDown}");
  expect(await screen.findByRole("menuitemradio", { name: "100%" })).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{End}{Enter}");
  expect(await screen.findByRole("button", { name: "缩放比例 400%" })).toBe(trigger);
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard("{ArrowDown}");
  expect(await screen.findByRole("menuitemradio", { name: "400%" })).toHaveAttribute("aria-checked", "true");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});
