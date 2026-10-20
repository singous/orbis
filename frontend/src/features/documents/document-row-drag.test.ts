import { ActivationController } from "@dnd-kit/abstract";
import { Accessibility, AutoScroller, KeyboardSensor, PointerSensor, type Draggable } from "@dnd-kit/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentRowPointerOptions, documentRowSensors, documentTreePlugins, DOCUMENT_DRAG_DISTANCE_PX, DOCUMENT_TOUCH_HOLD_MS, DOCUMENT_TOUCH_TOLERANCE_PX } from "./document-row-drag";

afterEach(() => { document.body.innerHTML = ""; vi.clearAllTimers(); vi.useRealTimers(); });

function row() {
  const element = document.createElement("div");
  element.setAttribute("data-document-drag-row", "");
  element.innerHTML = '<a href="/documents/id" data-document-row-link><span>Document</span></a><button><svg></svg></button><div data-document-row-action><span>Action</span></div><input/><a href="/settings">Other link</a>';
  document.body.append(element);
  return { element, source: { handle: element, element, disabled: false } as unknown as Draggable };
}

function pointer(target: Element, values: Partial<PointerEvent> = {}) {
  return { type: "pointerdown", target, button: 0, isPrimary: true, pointerType: "mouse", clientX: 0, clientY: 0, defaultPrevented: false, ...values } as PointerEvent;
}

describe("document row pointer policy", () => {
  it("allows the row and marked title without changing native click events", () => {
    const { element, source } = row();
    for (const target of [element, element.querySelector("a")!, element.querySelector("a span")!]) {
      const event = pointer(target);
      expect(documentRowPointerOptions.preventActivation!(event, source)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it.each(["button", "button svg", "[data-document-row-action] span", "input", "a[href='/settings']"])("excludes %s from starting a row drag", selector => {
    const { element, source } = row();
    expect(documentRowPointerOptions.preventActivation!(pointer(element.querySelector(selector)!), source)).toBe(true);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { button: 1 }, { defaultPrevented: true }, { isPrimary: false }])("preserves modified or already handled input %j", values => {
    const { element, source } = row();
    expect(documentRowPointerOptions.preventActivation!(pointer(element.querySelector("a")!, values), source)).toBe(true);
  });

  it("excludes read-only rows, other rows and descendants owned by another row", () => {
    const { element, source } = row();
    expect(documentRowPointerOptions.preventActivation!(pointer(element), { ...source, disabled: true } as Draggable)).toBe(true);
    const other = row().element;
    expect(documentRowPointerOptions.preventActivation!(pointer(other), source)).toBe(true);
    element.append(other);
    expect(documentRowPointerOptions.preventActivation!(pointer(other.querySelector("a")!), source)).toBe(true);
  });
});

describe("document row activation constraints", () => {
  it.each(["mouse", "pen"])("requires movement past the explicit distance for %s", pointerType => {
    const { element, source } = row();
    const event = pointer(element, { pointerType });
    const factory = documentRowPointerOptions.activationConstraints;
    if (typeof factory !== "function") throw new Error("Expected per-pointer constraints");
    const activate = vi.fn();
    const controller = new ActivationController(factory(event, source), activate);
    controller.onEvent(event);
    controller.onEvent(pointer(element, { pointerType, type: "pointermove", clientX: DOCUMENT_DRAG_DISTANCE_PX - 1 }));
    expect(activate).not.toHaveBeenCalled();
    controller.onEvent(pointer(element, { pointerType, type: "pointermove", clientX: DOCUMENT_DRAG_DISTANCE_PX + 1 }));
    expect(activate).toHaveBeenCalledOnce();
    controller.abort();
  });

  it("keeps touch taps and early scrolling outside the drag interaction", async () => {
    vi.useFakeTimers();
    const { element, source } = row();
    const factory = documentRowPointerOptions.activationConstraints;
    if (typeof factory !== "function") throw new Error("Expected per-pointer constraints");
    const activate = vi.fn();
    const touch = pointer(element, { pointerType: "touch" });
    const tap = new ActivationController(factory(touch, source), activate);
    tap.onEvent(touch);
    tap.abort(); // PointerSensor aborts a pending controller on pointerup.
    await vi.advanceTimersByTimeAsync(DOCUMENT_TOUCH_HOLD_MS + 1);
    expect(activate).not.toHaveBeenCalled();
    const scroll = new ActivationController(factory(touch, source), activate);
    scroll.onEvent(touch);
    scroll.onEvent(pointer(element, { type: "pointermove", pointerType: "touch", clientY: DOCUMENT_TOUCH_TOLERANCE_PX + 1 }));
    await vi.advanceTimersByTimeAsync(DOCUMENT_TOUCH_HOLD_MS + 1);
    expect(activate).not.toHaveBeenCalled();
    scroll.abort();
    const hold = new ActivationController(factory(touch, source), activate);
    hold.onEvent(touch);
    await vi.advanceTimersByTimeAsync(DOCUMENT_TOUCH_HOLD_MS - 1);
    expect(activate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(activate).toHaveBeenCalledOnce();
    hold.abort();
  });

  it("uses pointer-only sensors and preserves other provider plugins", () => {
    expect(documentRowSensors.map(sensor => sensor.plugin)).toEqual([PointerSensor]);
    expect(documentRowSensors.map(sensor => sensor.plugin)).not.toContain(KeyboardSensor);
    if (typeof documentTreePlugins !== "function") throw new Error("Expected a plugin filter");
    expect(documentTreePlugins([Accessibility, AutoScroller])).toEqual([AutoScroller]);
  });
});
