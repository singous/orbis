import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BoardMindmapControls } from "./BoardMindmapControls";
import { createMindmap, hiddenElements } from "./mindmap";
import type { Command } from "./model";

afterEach(cleanup);

function fixture(submit = vi.fn<(_: Command[]) => Promise<void>>().mockResolvedValue(undefined)) {
  const tree = createMindmap(crypto.randomUUID(), { x: 120, y: 220 });
  const props = { elements: new Map(tree.elements.map(element => [element.id, element])), selection: new Set([tree.rootID]), camera: { x: 80, y: 100, zoom: 1.25 }, readOnly: false, submit, onSelection: vi.fn(), onError: vi.fn() };
  const root = props.elements.get(tree.rootID)!;
  const result = render(<BoardMindmapControls {...props} />);
  return { ...result, props, root, submit };
}

it("adds a styled child and selects it only after the command is queued", async () => {
  let queued!: () => void;
  const board = fixture(vi.fn<(_: Command[]) => Promise<void>>(() => new Promise(resolve => { queued = resolve; })));
  await userEvent.click(screen.getByRole("button", { name: "为“中心主题”添加子主题" }));
  expect(board.submit).toHaveBeenCalledOnce();
  expect(board.props.onSelection).not.toHaveBeenCalled();
  const create = board.submit.mock.calls[0][0].at(-1)!;
  if (create.type !== "elements.create") throw Error("expected creation");
  expect(create.elements[0]).toMatchObject({ shape_type: "mindmap.topic", style: { fill: "transparent", align: "left" }, structure: { parent_id: board.root.id } });
  expect(screen.getByRole("button", { name: "为“中心主题”添加子主题" })).toBeDisabled();
  await act(async () => queued());
  expect(board.props.onSelection).toHaveBeenCalledWith(new Set([create.elements[0].id]));
});

it("collapses only the parent flag and presents the retained descendant count", async () => {
  const board = fixture();
  const before = JSON.stringify([...board.props.elements.values()]);
  await userEvent.click(screen.getByRole("button", { name: "收起“中心主题”的子主题" }));
  const command = board.submit.mock.calls[0][0][0];
  if (command.type !== "elements.update") throw Error("expected update");
  expect(command.patches).toHaveLength(1);
  expect(command.patches[0].structure?.collapsed).toBe(true);
  expect(command.patches[0].geometry).toBeUndefined();
  expect(JSON.stringify([...board.props.elements.values()])).toBe(before);
  const collapsed = { ...board.root, structure: command.patches[0].structure! };
  const elements = new Map(board.props.elements).set(board.root.id, collapsed);
  board.rerender(<BoardMindmapControls {...board.props} elements={elements} selection={new Set()} />);
  expect(screen.getByRole("button", { name: "展开“中心主题”的子主题" })).toHaveTextContent("9");
  expect(hiddenElements(elements).size).toBe(18);
  await userEvent.click(screen.getByRole("button", { name: "展开“中心主题”的子主题" }));
  const expand = board.submit.mock.calls.at(-1)![0][0];
  if (expand.type !== "elements.update") throw Error("expected update");
  expect(expand.patches[0].structure?.collapsed).toBe(false);
});

it("shows hovered branch actions and hides controls belonging to collapsed descendants", () => {
  const board = fixture();
  const branch = [...board.props.elements.values()].find(element => element.shape_type === "mindmap.topic")!;
  const collapsedBranch = { ...branch, structure: { ...branch.structure, collapsed: true } };
  const elements = new Map(board.props.elements).set(branch.id, collapsedBranch);
  board.rerender(<BoardMindmapControls {...board.props} elements={elements} selection={new Set()} hoveredID={branch.id} />);
  expect(screen.getByRole("button", { name: "展开“分支主题 1”的子主题" })).toHaveTextContent("2");
  expect(screen.queryByRole("button", { name: "为“分支主题 1”添加子主题" })).toBeNull();
  elements.set(board.root.id, { ...board.root, structure: { ...board.root.structure, collapsed: true } });
  board.rerender(<BoardMindmapControls {...board.props} elements={new Map(elements)} selection={new Set([branch.id])} hoveredID={branch.id} />);
  expect(screen.queryByRole("button", { name: "展开“分支主题 1”的子主题" })).toBeNull();
  expect(screen.getByRole("button", { name: "展开“中心主题”的子主题" })).toBeVisible();
});

it("anchors controls to the right port with a fixed screen offset under zoom", () => {
  const board = fixture();
  const button = screen.getByRole("button", { name: "收起“中心主题”的子主题" });
  const controls = button.closest(".board-mindmap-node-controls")!;
  expect(controls).toHaveStyle({ left: `${(120 + 200) * 1.25 + 80 + 28}px`, top: `${(220 + 22) * 1.25 + 100}px` });
  board.rerender(<BoardMindmapControls {...board.props} camera={{ x: 20, y: 30, zoom: 2 }} />);
  expect(controls).toHaveStyle({ left: `${(120 + 200) * 2 + 20 + 28}px`, top: `${(220 + 22) * 2 + 30}px` });
});

it("provides no editing controls to readers and ignores stale selection after unmount", async () => {
  let queued!: () => void;
  const board = fixture(vi.fn<(_: Command[]) => Promise<void>>(() => new Promise(resolve => { queued = resolve; })));
  board.rerender(<BoardMindmapControls {...board.props} readOnly />);
  expect(screen.queryByRole("button")).toBeNull();
  board.rerender(<BoardMindmapControls {...board.props} />);
  await userEvent.click(screen.getByRole("button", { name: "为“中心主题”添加子主题" }));
  board.unmount();
  await act(async () => queued());
  expect(board.props.onSelection).not.toHaveBeenCalled();
});

it("suppresses old-page callbacks when the parent disappears while saving", async () => {
  let queued!: () => void;
  const board = fixture(vi.fn<(_: Command[]) => Promise<void>>(() => new Promise(resolve => { queued = resolve; })));
  await userEvent.click(screen.getByRole("button", { name: "为“中心主题”添加子主题" }));
  board.rerender(<BoardMindmapControls {...board.props} elements={new Map()} selection={new Set()} />);
  await act(async () => queued());
  expect(board.props.onSelection).not.toHaveBeenCalled();
});
