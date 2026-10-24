import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BoardInspector } from "./BoardInspector";
import { makeElement, type BoardPage } from "./model";

afterEach(cleanup);
function mount(readOnly = false, parent = false) {
  const page: BoardPage = { id: crypto.randomUUID(), name: "页面 1", background: "#ffffff", position: 0, version: 1 };
  const element = makeElement("flow.process", page.id, 100, 100);
  const container = makeElement("basic.group", page.id, 0, 0);
  container.text = "业务分组";
  element.text = "核验资料";
  if (parent) element.structure.parent_id = container.id;
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<BoardInspector elements={new Map([element, container].map(item => [item.id, item]))} selection={new Set([element.id])} page={page} submit={submit} readOnly={readOnly} onError={vi.fn()} />);
  return { submit, element };
}

it("keeps the text draft until blur or Enter and ignores IME confirmation", async () => {
  const { submit, element } = mount();
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "文字" });
  await user.clear(input);
  await user.type(input, "核验资料与权限");
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(input).toHaveFocus();
  expect(submit).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(submit).toHaveBeenCalledExactlyOnceWith([{ type: "elements.update", patches: [expect.objectContaining({ id: element.id, text: "核验资料与权限", expected: element.versions })] }]);
});

it("uses keyboard tabs and HeroUI checkboxes to commit style changes", async () => {
  const { submit, element } = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "属性" }));
  await user.keyboard("{ArrowRight}");
  const styleTab = screen.getByRole("tab", { name: "样式" });
  expect(styleTab).toHaveFocus();
  expect(styleTab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: "样式" })).toHaveAttribute("aria-labelledby", styleTab.id);
  await user.click(screen.getByRole("checkbox", { name: "粗体" }));
  expect(submit).toHaveBeenCalledWith([{ type: "elements.update", patches: [expect.objectContaining({ id: element.id, style: expect.objectContaining({ bold: !element.style.bold }) })] }]);
});

it("preserves the empty parent value when selecting none through the shared SelectField", async () => {
  const { submit, element } = mount(false, true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /父容器/ }));
  await user.click(screen.getByRole("option", { name: "无" }));
  expect(submit).toHaveBeenCalledWith([{ type: "elements.update", patches: [expect.objectContaining({ id: element.id, structure: expect.objectContaining({ parent_id: null }) })] }]);
});

it("commits a typed color on blur without sending intermediate colors or duplicate writes", async () => {
  const { submit } = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "样式" }));
  await user.click(screen.getByRole("button", { name: "选择填充颜色" }));
  const input = screen.getByRole("textbox", { name: /^十六进制颜色/ });
  await user.clear(input);
  await user.type(input, "123456");
  expect(submit).not.toHaveBeenCalled();
  await user.tab();
  expect(submit).toHaveBeenCalledExactlyOnceWith([{ type: "elements.update", patches: [expect.objectContaining({ style: expect.objectContaining({ fill: "#123456" }) })] }]);
  await user.keyboard("{Escape}");
  expect(submit).toHaveBeenCalledOnce();
});

it("disables input, selection, checkbox and color controls for readers", async () => {
  const { submit } = mount(true);
  const user = userEvent.setup();
  expect(screen.getByRole("textbox", { name: "文字" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /父容器/ })).toBeDisabled();
  await user.click(screen.getByRole("tab", { name: "样式" }));
  expect(screen.getByRole("button", { name: "选择填充颜色" })).toBeDisabled();
  const bold = screen.getByRole("checkbox", { name: "粗体" });
  expect(bold).toBeDisabled();
  await user.click(bold);
  expect(submit).not.toHaveBeenCalled();
});
