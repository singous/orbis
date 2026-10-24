import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BoardInspector } from "./BoardInspector";
import { makeElement, type BoardPage, type Command, type Element } from "./model";
import { appendTopic, createMindmap, hiddenElements, isMindmapTopic, toggleTopicCollapsed } from "./mindmap";

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

it("expands a compacted mindmap branch from its checkbox with one atomic layout update", async () => {
  const page: BoardPage = { id: crypto.randomUUID(), name: "思维导图", background: "#ffffff", position: 0, version: 1 };
  const tree = createMindmap(page.id, { x: 120, y: 220 });
  const elements = new Map(tree.elements.map(element => [element.id, element]));
  function apply(commands: Command[]) {
    for (const command of commands) {
      if (command.type === "elements.create")
        for (const element of command.elements) elements.set(element.id, element);
      if (command.type === "elements.update")
        for (const patch of command.patches) {
          const previous = elements.get(patch.id)!;
          elements.set(patch.id, {
            ...previous,
            ...(patch.geometry ? { geometry: patch.geometry } : {}),
            ...(patch.structure ? { structure: patch.structure } : {}),
          });
        }
    }
  }
  const first = tree.elements.find(element => element.shape_type === "mindmap.topic")!;
  apply(toggleTopicCollapsed(first, elements));
  apply(appendTopic(elements.get(first.id)!, elements, true).commands);
  const before = new Map(elements);
  const source = JSON.stringify([...elements.values()]);
  const submit = vi.fn<(commands: Command[]) => Promise<void>>().mockResolvedValue(undefined);
  render(<BoardInspector elements={elements} selection={new Set([first.id])} page={page} submit={submit} readOnly={false} onError={vi.fn()} />);
  const collapsed = screen.getByRole("checkbox", { name: "折叠子主题" });
  expect(collapsed).toBeChecked();
  await userEvent.setup().click(collapsed);

  expect(submit).toHaveBeenCalledOnce();
  const commands = submit.mock.calls[0][0];
  expect(commands).toHaveLength(1);
  const update = commands[0];
  if (update.type !== "elements.update") throw new Error("Expansion must be an atomic element update");
  expect(new Set(update.patches.map(patch => patch.id)).size).toBe(update.patches.length);
  expect(update.patches.find(patch => patch.id === first.id)).toMatchObject({
    expected: before.get(first.id)!.versions,
    structure: { ...before.get(first.id)!.structure, collapsed: false },
  });
  for (const patch of update.patches) {
    expect(patch.expected).toEqual(before.get(patch.id)!.versions);
    expect(patch.style).toBeUndefined();
    expect(patch.text).toBeUndefined();
  }
  expect(JSON.stringify([...elements.values()])).toBe(source);
  apply(commands);
  expect(elements.get(tree.rootID)!.geometry).toEqual(before.get(tree.rootID)!.geometry);
  expect(elements.get(first.id)!.structure.collapsed).toBe(false);
  const hidden = hiddenElements(elements);
  const topics = [...elements.values()].filter(element => isMindmapTopic(element) && !hidden.has(element.id));
  const leaves = topics.filter(element => !topics.some(child => child.structure.parent_id === element.id));
  function overlaps(a: Element, b: Element) {
    return a.geometry.x < b.geometry.x + b.geometry.width &&
      a.geometry.x + a.geometry.width > b.geometry.x &&
      a.geometry.y < b.geometry.y + b.geometry.height &&
      a.geometry.y + a.geometry.height > b.geometry.y;
  }
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++)
      expect(overlaps(leaves[i], leaves[j]), `${leaves[i].text} and ${leaves[j].text} must not overlap`).toBe(false);
});
