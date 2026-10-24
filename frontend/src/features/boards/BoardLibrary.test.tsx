import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { BoardLibrary, type BoardLibraryTab } from "./BoardLibrary";
import { makeElement } from "./model";

vi.mock("./icons", () => ({ iconIndex: () => Promise.resolve([]), iconImage: vi.fn() }));
afterEach(cleanup);
function mount(readOnly = false) {
  const onShape = vi.fn();
  const element = makeElement("flow.process", crypto.randomUUID(), 0, 0);
  element.text = "审批步骤";
  function Library() {
    const [tab, setTab] = useState<BoardLibraryTab>("shapes");
    return <BoardLibrary tab={tab} onTab={setTab} elements={new Map([[element.id, element]])} selection={new Set()} readOnly={readOnly} onShape={onShape} onIcon={vi.fn()} onTemplate={vi.fn()} onSelect={vi.fn()} />;
  }
  render(<Library />);
  return { onShape };
}

it("preserves tab focus and matching panels during keyboard navigation", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "图形" }));
  await user.keyboard("{End}");
  const layers = screen.getByRole("tab", { name: "图层" });
  expect(layers).toHaveFocus();
  expect(layers).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: "图层" })).toHaveAttribute("aria-labelledby", layers.id);
  expect(screen.getByRole("button", { name: "审批步骤" })).toBeVisible();
  expect(screen.queryByRole("tabpanel", { name: "图形" })).toBeNull();
});

it("uses the shared category picker and preserves shape drag payloads", async () => {
  const { onShape } = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /图类型/ }));
  await user.click(screen.getByRole("option", { name: "ER 图" }));
  const entity = screen.getByRole("button", { name: "实体" });
  const setData = vi.fn();
  const source = entity.closest('[draggable="true"]');
  expect(source).not.toBeNull();
  fireEvent.dragStart(source!, { dataTransfer: { setData } });
  expect(setData).toHaveBeenCalledWith("application/x-orbis-shape", "er.entity");
  await user.click(entity);
  expect(onShape).toHaveBeenCalledWith("er.entity");
});

it("keeps shapes disabled and non-draggable for readers", async () => {
  const { onShape } = mount(true);
  const shape = screen.getByRole("button", { name: "矩形" });
  expect(shape).toBeDisabled();
  expect(shape.closest('[draggable="false"]')).not.toBeNull();
  await userEvent.click(shape);
  expect(onShape).not.toHaveBeenCalled();
});

it("keeps mind maps out of the shape picker while preserving their templates", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /图类型/ }));
  expect(screen.queryByRole("option", { name: "思维导图" })).toBeNull();
  await user.click(screen.getByRole("option", { name: "全部类别" }));
  expect(screen.queryByRole("button", { name: "中心主题" })).toBeNull();
  expect(screen.queryByRole("button", { name: "子主题" })).toBeNull();
  await user.click(screen.getByRole("tab", { name: "模板" }));
  await user.click(screen.getByRole("button", { name: /图类型/ }));
  expect(screen.getByRole("option", { name: "思维导图" })).toBeVisible();
});
