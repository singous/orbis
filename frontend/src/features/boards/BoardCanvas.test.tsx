import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeElement } from "./model";
import { BoardCanvas } from "./BoardCanvas";

type CanvasEvents = ConstructorParameters<typeof import("./renderer").BoardRenderer>[1];
const drawing = vi.hoisted(() => ({ events: null as CanvasEvents | null, clear: vi.fn(), preview: vi.fn() }));
vi.mock("./renderer", () => ({
  BoardRenderer: class {
    stage = { getContent: () => document.createElement("div") };
    constructor(container: HTMLDivElement, events: CanvasEvents) {
      // Konva owns and clears its host; React overlays must live outside that host.
      container.replaceChildren();
      drawing.events = events;
    }
    setCamera() {}
    setElements() {}
    setSelection() {}
    setCanvasTextColor() {}
    setPreview(elements: unknown) { drawing.preview(elements); }
    clearPreview() { drawing.clear(); }
    destroy() {}
  },
}));
vi.mock("./BoardSelectionToolbar", () => ({
  BoardSelectionToolbar: ({ bounds, children }: { bounds: { x: number; y: number }; children: React.ReactNode }) => <div data-testid="selection-actions" data-x={bounds.x} data-y={bounds.y}>{children}</div>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(readOnly = false) {
  const onTool = vi.fn();
  const onUndo = vi.fn();
  render(<BoardCanvas elements={new Map()} pageID="page" selection={new Set()} onSelection={vi.fn()} camera={{ x: 0, y: 0, zoom: 1 }} onCamera={vi.fn()} tool="select" onTool={onTool} submit={vi.fn().mockResolvedValue(undefined)} readOnly={readOnly} rendererRef={{ current: null }} onError={vi.fn()} onUndo={onUndo} onRedo={vi.fn()} />);
  return { canvas: screen.getByRole("application", { name: "画板编辑区域" }), onTool, onUndo };
}

describe("board tool shortcuts", () => {
  it("switches tools without stealing command shortcuts or composed text", () => {
    const { canvas, onTool, onUndo } = mount();
    for (const [key, tool] of [["v", "select"], ["H", "pan"], ["t", "basic.text"], ["p", "draw"], ["c", "connect"], ["m", "mindmap"]]) {
      fireEvent.keyDown(canvas, { key });
      expect(onTool).toHaveBeenLastCalledWith(tool);
    }
    onTool.mockClear();
    fireEvent.keyDown(canvas, { key: "p", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "p", altKey: true });
    fireEvent.keyDown(canvas, { key: "p", isComposing: true });
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(onTool).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("keeps drawing tools unavailable to readers while allowing selection and panning", () => {
    const { canvas, onTool } = mount(true);
    for (const key of ["t", "p", "c"]) fireEvent.keyDown(canvas, { key });
    expect(onTool).not.toHaveBeenCalled();
    fireEvent.keyDown(canvas, { key: "h" });
    expect(onTool).toHaveBeenLastCalledWith("pan");
    fireEvent.keyDown(canvas, { key: "v" });
    expect(onTool).toHaveBeenLastCalledWith("select");
  });
});

function movableBoard(submit: () => Promise<void>) {
  const element = makeElement("flow.process", crypto.randomUUID(), 100, 160);
  render(<BoardCanvas elements={new Map([[element.id, element]])} pageID={element.page_id} selection={new Set([element.id])} onSelection={vi.fn()} camera={{ x: 80, y: 80, zoom: 1 }} onCamera={vi.fn()} tool="select" onTool={vi.fn()} submit={submit} readOnly={false} rendererRef={{ current: null }} onError={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} selectionActions={<button>复制</button>} />);
  const pointer = (x: number, y: number, type: string) => ({ id: element.id, point: { x, y }, screen: { x: x + 80, y: y + 80 }, event: new MouseEvent(type, { button: 0 }) as PointerEvent });
  return { element, pointer };
}

it("moves the action anchor with the drag and keeps the preview until the move is queued", async () => {
  let queued!: () => void;
  const submit = vi.fn(() => new Promise<void>(resolve => { queued = resolve; }));
  const { pointer } = movableBoard(submit);
  act(() => drawing.events!.down(pointer(100, 160, "pointerdown")));
  act(() => drawing.events!.move(pointer(140, 180, "pointermove")));
  expect(screen.getByTestId("selection-actions")).toHaveAttribute("data-x", "140");
  expect(screen.getByTestId("selection-actions")).toHaveAttribute("data-y", "180");
  act(() => drawing.events!.up(pointer(140, 180, "pointerup")));
  expect(drawing.clear).not.toHaveBeenCalled();
  expect(submit).toHaveBeenCalledOnce();
  await act(async () => queued());
  expect(drawing.clear).toHaveBeenCalledOnce();
});

it.each(["connector", "deselect"])("does not submit an empty move when dragging %s", async (kind) => {
  const element = makeElement(kind === "connector" ? "connector" : "flow.process", crypto.randomUUID(), 100, 160);
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<BoardCanvas elements={new Map([[element.id, element]])} pageID={element.page_id} selection={new Set([element.id])} onSelection={vi.fn()} camera={{ x: 0, y: 0, zoom: 1 }} onCamera={vi.fn()} tool="select" onTool={vi.fn()} submit={submit} readOnly={false} rendererRef={{ current: null }} onError={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} />);
  const pointer = (x: number, type: string) => ({ id: element.id, point: { x, y: 160 }, screen: { x, y: 160 }, event: new MouseEvent(type, { button: 0, shiftKey: kind === "deselect" }) as PointerEvent });
  await act(async () => {
    drawing.events!.down(pointer(100, "pointerdown"));
    drawing.events!.move(pointer(108, "pointermove"));
    drawing.events!.up(pointer(108, "pointerup"));
  });
  expect(submit).not.toHaveBeenCalled();
});

it("does not clear a newer drag when the previous move finishes, and restores on cancel", async () => {
  let queued!: () => void;
  const submit = vi.fn(() => new Promise<void>(resolve => { queued = resolve; }));
  const { pointer } = movableBoard(submit);
  act(() => { drawing.events!.down(pointer(100, 160, "pointerdown")); drawing.events!.move(pointer(140, 180, "pointermove")); drawing.events!.up(pointer(140, 180, "pointerup")); });
  act(() => { drawing.events!.down(pointer(100, 160, "pointerdown")); drawing.events!.move(pointer(160, 200, "pointermove")); });
  await act(async () => queued());
  expect(drawing.clear).not.toHaveBeenCalled();
  expect(screen.getByTestId("selection-actions")).toHaveAttribute("data-x", "160");
  act(() => drawing.events!.up(pointer(160, 200, "pointercancel")));
  expect(drawing.clear).toHaveBeenCalledOnce();
  expect(screen.getByTestId("selection-actions")).toHaveAttribute("data-x", "100");
});

function connectableBoard(readOnly = false, tool = "select") {
  const first = makeElement("flow.process", crypto.randomUUID(), 100, 160);
  first.text = "起点";
  const second = makeElement("flow.process", first.page_id, 420, 160);
  second.text = "终点";
  const submit = vi.fn().mockResolvedValue(undefined), onTool = vi.fn();
  render(<BoardCanvas elements={new Map([first, second].map(element => [element.id, element]))} pageID={first.page_id} selection={new Set()} onSelection={vi.fn()} camera={{ x: 80, y: 80, zoom: 1 }} onCamera={vi.fn()} tool={tool} onTool={onTool} submit={submit} readOnly={readOnly} rendererRef={{ current: null }} onError={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} />);
  const pointer = (id: string | null, x: number, y: number, type: string) => ({ id, point: { x, y }, screen: { x: x + 80, y: y + 80 }, event: new MouseEvent(type, { button: 0 }) as PointerEvent });
  return { first, second, submit, onTool, pointer };
}

it("shows hover connection points without selecting a shape and hides them outside it or during a normal move", () => {
  const { first, pointer } = connectableBoard();
  act(() => drawing.events!.move(pointer(first.id, 160, 180, "pointermove")));
  expect(screen.getByRole("button", { name: "起点 右侧连接点" })).toBeVisible();
  expect(screen.getAllByRole("button").filter(button => button.getAttribute("aria-label")?.startsWith("起点 "))).toHaveLength(4);
  act(() => drawing.events!.move(pointer(null, 350, 100, "pointermove")));
  expect(screen.queryByRole("button", { name: "起点 右侧连接点" })).toBeNull();
  act(() => drawing.events!.move(pointer(first.id, 160, 180, "pointermove")));
  act(() => drawing.events!.down(pointer(first.id, 160, 180, "pointerdown")));
  expect(screen.queryByRole("button", { name: "起点 右侧连接点" })).toBeNull();
  act(() => drawing.events!.up(pointer(first.id, 160, 180, "pointerup")));
});

it.each([[true, "select"], [false, "pan"], [false, "draw"]])("keeps hover ports unavailable for readonly=%s and tool=%s", (readOnly, tool) => {
  const { first, pointer } = connectableBoard(readOnly as boolean, tool as string);
  act(() => drawing.events!.move(pointer(first.id, 160, 180, "pointermove")));
  expect(screen.queryByRole("button", { name: "起点 右侧连接点" })).toBeNull();
});

it("preserves the existing two-click connector tool and its bound ports", () => {
  const { first, second, pointer, submit, onTool } = connectableBoard(false, "connect");
  act(() => { drawing.events!.down(pointer(first.id, 280, 200, "pointerdown")); drawing.events!.up(pointer(first.id, 280, 200, "pointerup")); });
  expect(submit).not.toHaveBeenCalled();
  act(() => { drawing.events!.down(pointer(second.id, 420, 200, "pointerdown")); drawing.events!.up(pointer(second.id, 420, 200, "pointerup")); });
  expect(submit).toHaveBeenCalledOnce();
  const edge = submit.mock.calls[0][0][0].elements[0];
  expect(edge.structure.start).toMatchObject({ element_id: first.id, port: "right" });
  expect(edge.structure.end).toMatchObject({ element_id: second.id, port: "left" });
  expect(onTool).toHaveBeenCalledWith("select");
});

it("lets HeroUI ports handle Space without triggering canvas panning or text editing", async () => {
  const user = userEvent.setup();
  const { first, second, pointer, submit, onTool } = connectableBoard();
  act(() => drawing.events!.move(pointer(first.id, 160, 180, "pointermove")));
  act(() => screen.getByRole("button", { name: "起点 右侧连接点" }).focus());
  await user.keyboard(" ");
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "起点 右侧连接点" })).toHaveAttribute("aria-pressed", "true");
  act(() => drawing.events!.move(pointer(second.id, 450, 180, "pointermove")));
  act(() => screen.getByRole("button", { name: "终点 左侧连接点" }).focus());
  await user.keyboard(" ");
  expect(submit).toHaveBeenCalledOnce();
  expect(onTool).toHaveBeenCalledWith("select");
});

it("does not let a queued shape move clear a newer connection draft", async () => {
  let queued!: () => void;
  const submit = vi.fn(() => new Promise<void>(resolve => { queued = resolve; }));
  const { pointer } = movableBoard(submit);
  act(() => { drawing.events!.down(pointer(100, 160, "pointerdown")); drawing.events!.move(pointer(140, 180, "pointermove")); drawing.events!.up(pointer(140, 180, "pointerup")); });
  const down = new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(down, "pointerId", { value: 7 });
  fireEvent(screen.getByRole("button", { name: /右侧连接点/ }).querySelector("path")!, down);
  const before = drawing.clear.mock.calls.length;
  expect(drawing.preview).toHaveBeenLastCalledWith([expect.objectContaining({ shape_type: "connector" })]);
  await act(async () => queued());
  expect(drawing.clear).toHaveBeenCalledTimes(before);
});

it("creates a complete mind map from the primary tool using one undoable command", async () => {
  const { pointer, submit, onTool } = connectableBoard(false, "mindmap");
  await act(async () => {
    drawing.events!.down(pointer(null, 160, 180, "pointerdown"));
    drawing.events!.up(pointer(null, 160, 180, "pointerup"));
  });
  expect(submit).toHaveBeenCalledOnce();
  const commands = submit.mock.calls[0][0];
  expect(commands).toHaveLength(1);
  expect(commands[0].type).toBe("elements.create");
  const values = commands[0].elements;
  const root = values.find((element: ReturnType<typeof makeElement>) => element.shape_type === "mindmap.root");
  expect(root).toBeDefined();
  expect(values.some((element: ReturnType<typeof makeElement>) => element.structure.parent_id === root.id)).toBe(true);
  expect(values.some((element: ReturnType<typeof makeElement>) => element.shape_type === "connector")).toBe(true);
  expect(onTool).toHaveBeenCalledWith("select");
});

it("keeps mindmap controls reachable across the gap beside a hovered topic", () => {
  const root = makeElement("mindmap.root", crypto.randomUUID(), 100, 160);
  root.text = "中心主题";
  const child = makeElement("mindmap.topic", root.page_id, 420, 160);
  child.structure.parent_id = root.id;
  render(<BoardCanvas elements={new Map([root, child].map(element => [element.id, element]))} pageID={root.page_id} selection={new Set()} onSelection={vi.fn()} camera={{ x: 0, y: 0, zoom: 1 }} onCamera={vi.fn()} tool="select" onTool={vi.fn()} submit={vi.fn().mockResolvedValue(undefined)} readOnly={false} rendererRef={{ current: null }} onError={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} />);
  const move = (id: string | null, x: number, y: number) => ({ id, point: { x, y }, screen: { x, y }, event: new MouseEvent("pointermove") as PointerEvent });
  act(() => drawing.events!.move(move(root.id, 140, 180)));
  expect(screen.getByRole("button", { name: "收起“中心主题”的子主题" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "中心主题 右侧连接点" })).toBeNull();
  act(() => drawing.events!.move(move(null, root.geometry.x + root.geometry.width + 8, root.geometry.y + root.geometry.height / 2)));
  expect(screen.getByRole("button", { name: "收起“中心主题”的子主题" })).toBeVisible();
  act(() => drawing.events!.move(move(null, 700, 500)));
  expect(screen.queryByRole("button", { name: "收起“中心主题”的子主题" })).toBeNull();
});


it("handles canvas shortcuts inside a noneditable embed nested in the document editor", () => {
  const element = makeElement("flow.process", "page", 0, 0);
  const onSelection = vi.fn();
  render(<div contentEditable suppressContentEditableWarning><div contentEditable={false}>
    <BoardCanvas elements={new Map([[element.id, element]])} pageID="page" selection={new Set()} onSelection={onSelection} camera={{ x: 0, y: 0, zoom: 1 }} onCamera={vi.fn()} tool="select" onTool={vi.fn()} submit={vi.fn().mockResolvedValue(undefined)} readOnly={false} rendererRef={{ current: null }} onError={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} />
  </div></div>);
  fireEvent.keyDown(screen.getByRole("application", { name: "画板编辑区域" }), { key: "a", ctrlKey: true });
  expect(onSelection).toHaveBeenCalledWith(new Set([element.id]));
});
