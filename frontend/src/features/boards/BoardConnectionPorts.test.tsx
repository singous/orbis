import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { BoardConnectionPorts } from "./BoardConnectionPorts";
import { makeElement, type Command } from "./model";
import type { BoardRenderer } from "./renderer";

afterEach(cleanup);

function fixture(submit = vi.fn<(_: Command[]) => Promise<void>>().mockResolvedValue(undefined)) {
  const pageID = crypto.randomUUID();
  const source = makeElement("flow.process", pageID, 100, 100);
  const target = makeElement("flow.process", pageID, 500, 100);
  source.text = "开始";
  target.text = "完成";
  const viewport = document.createElement("div");
  viewport.tabIndex = 0;
  viewport.getBoundingClientRect = () => ({ left: 20, top: 30, right: 1020, bottom: 830, width: 1000, height: 800, x: 20, y: 30, toJSON() {} });
  const capture = document.createElement("div");
  capture.setPointerCapture = vi.fn();
  capture.releasePointerCapture = vi.fn();
  const renderer = { stage: { getContent: () => capture }, setPreview: vi.fn(), clearPreview: vi.fn(), worldPoint: ({ x, y }: { x: number; y: number }) => ({ x: (x - 80) / 1.25, y: (y - 100) / 1.25 }) };
  const props = { elements: new Map([source, target].map(element => [element.id, element])), pageID, camera: { x: 80, y: 100, zoom: 1.25 }, hoveredID: source.id, selection: new Set<string>(), enabled: true, viewport: { current: viewport }, renderer: { current: renderer as unknown as BoardRenderer }, submit, onSelection: vi.fn(), onTool: vi.fn(), onError: vi.fn() };
  const result = render(<BoardConnectionPorts {...props} />);
  const pointer = (node: HTMLElement | Window, type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: 20 + 80 + x * 1.25, clientY: 30 + 100 + y * 1.25 });
    Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: "mouse" }, isPrimary: { value: true } });
    fireEvent(node, event);
  };
  const begin = () => pointer(screen.getByRole("button", { name: "开始 右侧连接点" }), "pointerdown", 280, 140);
  return { ...result, props, source, target, renderer, capture, pointer, begin, submit };
}

it("previews a snapped connection and queues one bound edge only after release", async () => {
  let queued!: () => void;
  const submit = vi.fn<(_: Command[]) => Promise<void>>(() => new Promise<void>(resolve => { queued = resolve; }));
  const board = fixture(submit);
  expect(screen.getAllByRole("button")).toHaveLength(4);
  board.begin();
  expect(board.capture.setPointerCapture).toHaveBeenCalledWith(7);
  board.pointer(window, "pointermove", 501, 141);
  const preview = board.renderer.setPreview.mock.calls.at(-1)![0][0];
  expect(preview.structure.end).toMatchObject({ element_id: board.target.id, port: "left", x: 500, y: 140 });
  expect(submit).not.toHaveBeenCalled();
  board.pointer(window, "pointerup", 501, 141);
  board.pointer(window, "pointerup", 501, 141);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][0][0]).toMatchObject({ type: "elements.create", elements: [{ page_id: board.props.pageID, structure: { start: { element_id: board.source.id, port: "right" }, end: { element_id: board.target.id, port: "left" } } }] });
  expect(board.renderer.clearPreview).not.toHaveBeenCalled();
  await act(async () => queued());
  expect(board.renderer.clearPreview).toHaveBeenCalledOnce();
  expect(board.props.onSelection).toHaveBeenCalledWith(new Set([preview.id]));
  expect(board.props.onTool).toHaveBeenCalledWith("select");
});

it("cancels empty drops and drops back onto the source without writing", () => {
  const board = fixture();
  for (const point of [{ x: 400, y: 300 }, { x: 280, y: 140 }]) {
    board.begin();
    board.pointer(window, "pointermove", point.x, point.y);
    board.pointer(window, "pointerup", point.x, point.y);
  }
  expect(board.submit).not.toHaveBeenCalled();
  expect(board.renderer.clearPreview).toHaveBeenCalledTimes(2);
});

it.each(["pointercancel", "lostpointercapture", "blur", "Escape"])("cleans the draft on %s and ignores the later release", event => {
  const board = fixture();
  board.begin();
  board.pointer(window, "pointermove", 500, 140);
  if (event === "Escape") fireEvent.keyDown(window, { key: "Escape" });
  else if (event === "blur") fireEvent.blur(window);
  else board.pointer(window, event, 500, 140);
  board.pointer(window, "pointerup", 500, 140);
  expect(board.submit).not.toHaveBeenCalled();
  expect(board.renderer.clearPreview).toHaveBeenCalledOnce();
  board.rerender(<BoardConnectionPorts {...board.props} />);
  expect(screen.getByRole("button", { name: "开始 右侧连接点" })).toHaveAttribute("aria-pressed", "false");
});

it("removes points and cancels without writing when editing becomes unavailable", () => {
  const board = fixture();
  board.begin();
  board.rerender(<BoardConnectionPorts {...board.props} enabled={false} />);
  board.pointer(window, "pointerup", 500, 140);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(board.submit).not.toHaveBeenCalled();
  expect(board.renderer.clearPreview).toHaveBeenCalledOnce();
  board.rerender(<BoardConnectionPorts {...board.props} />);
  expect(screen.getByRole("button", { name: "开始 右侧连接点" })).toHaveAttribute("aria-pressed", "false");
});

it("revalidates endpoints against live elements before creating the edge", () => {
  const board = fixture();
  board.begin();
  board.pointer(window, "pointermove", 500, 140);
  board.rerender(<BoardConnectionPorts {...board.props} elements={new Map([[board.source.id, board.source]])} />);
  expect(board.renderer.setPreview.mock.calls.at(-1)![0][0].structure.end).toMatchObject({ element_id: null, x: 500, y: 140 });
  board.pointer(window, "pointerup", 500, 140);
  expect(board.submit).not.toHaveBeenCalled();
});

it("cancels a stationary connection as soon as its source is removed", () => {
  const board = fixture();
  board.begin();
  board.pointer(window, "pointermove", 500, 140);
  board.rerender(<BoardConnectionPorts {...board.props} elements={new Map([[board.target.id, board.target]])} />);
  expect(board.renderer.clearPreview).toHaveBeenCalledOnce();
  board.pointer(window, "pointerup", 500, 140);
  expect(board.submit).not.toHaveBeenCalled();
});

it("does not let a previous queued save clear a newer connection drag", async () => {
  let queued!: () => void;
  const board = fixture(vi.fn(() => new Promise<void>(resolve => { queued = resolve; })));
  board.begin();
  board.pointer(window, "pointerup", 500, 140);
  board.begin();
  board.pointer(window, "pointermove", 420, 300);
  const cleared = board.renderer.clearPreview.mock.calls.length;
  await act(async () => queued());
  expect(board.renderer.clearPreview).toHaveBeenCalledTimes(cleared);
  expect(board.props.onSelection).not.toHaveBeenCalled();
  board.pointer(window, "pointercancel", 420, 300);
});

it("clears an awaiting preview and suppresses selection after unmount", async () => {
  let queued!: () => void;
  const board = fixture(vi.fn(() => new Promise<void>(resolve => { queued = resolve; })));
  board.begin();
  board.pointer(window, "pointerup", 500, 140);
  board.unmount();
  expect(board.renderer.clearPreview).toHaveBeenCalledOnce();
  await act(async () => queued());
  expect(board.props.onSelection).not.toHaveBeenCalled();
  expect(board.props.onTool).not.toHaveBeenCalled();
});

it("reports a queue failure and restores the canvas without selecting an unsaved edge", async () => {
  const error = new Error("本地修改日志不可写");
  const board = fixture(vi.fn().mockRejectedValue(error));
  board.begin();
  await act(async () => board.pointer(window, "pointerup", 500, 140));
  expect(board.props.onError).toHaveBeenCalledWith(error);
  expect(board.renderer.clearPreview).toHaveBeenCalledOnce();
  expect(board.props.onSelection).not.toHaveBeenCalled();
});

it("supports choosing two ports with the keyboard", async () => {
  const user = userEvent.setup();
  const board = fixture();
  act(() => screen.getByRole("button", { name: "开始 右侧连接点" }).focus());
  await user.keyboard("[Enter]");
  expect(board.submit).not.toHaveBeenCalled();
  board.rerender(<BoardConnectionPorts {...board.props} hoveredID={board.target.id} />);
  act(() => screen.getByRole("button", { name: "完成 左侧连接点" }).focus());
  await user.keyboard("[Space]");
  expect(board.submit).toHaveBeenCalledOnce();
});
