import { Accessibility, PointerActivationConstraints, PointerSensor, type DragDropManagerInput, type PointerSensorOptions } from "@dnd-kit/dom";

export const DOCUMENT_DRAG_DISTANCE_PX = 8;
export const DOCUMENT_TOUCH_HOLD_MS = 250;
export const DOCUMENT_TOUCH_TOLERANCE_PX = 5;

const ROW_SELECTOR = "[data-document-drag-row]";
const ROW_LINK_ATTRIBUTE = "data-document-row-link";
const EXCLUDED_CONTROLS = [
  "button", "input", "textarea", "select", "[role=button]", "[role=menuitem]",
  "[data-document-row-action]", "[contenteditable]:not([contenteditable=false])",
].join(",");

/** Drag only the owning row, leaving links, modifiers and row actions native. */
export const documentRowPointerOptions: PointerSensorOptions = {
  preventActivation(event, source) {
    if (source.disabled || event.defaultPrevented || event.button !== 0 || event.isPrimary === false ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
    const target = event.target;
    const row = source.handle ?? source.element;
    if (!(target instanceof Element) || !row || !row.contains(target) || target.closest(ROW_SELECTOR) !== row) return true;
    if (target.closest(EXCLUDED_CONTROLS)) return true;
    const link = target.closest("a[href]");
    return Boolean(link && !link.hasAttribute(ROW_LINK_ATTRIBUTE));
  },
  activationConstraints(event) {
    // A handle normally activates immediately for a mouse in dnd-kit 0.5.
    // Explicit constraints keep ordinary clicks and touch scrolling available.
    return event.pointerType === "touch"
      ? [new PointerActivationConstraints.Delay({ value: DOCUMENT_TOUCH_HOLD_MS, tolerance: DOCUMENT_TOUCH_TOLERANCE_PX })]
      : [new PointerActivationConstraints.Distance({ value: DOCUMENT_DRAG_DISTANCE_PX })];
  },
};

// Enter follows the native document link; Alt+Arrow is the separate reorder
// command. A KeyboardSensor would intercept Enter/Space on a row activator.
export const documentRowSensors = [PointerSensor.configure(documentRowPointerOptions)];

// The default plugin assigns role=button and aria-pressed to the activator.
// The tree supplies native links, keyboard instructions and its own live status.
export const documentTreePlugins: NonNullable<DragDropManagerInput["plugins"]> = defaults =>
  defaults.filter(entry => (typeof entry === "function" ? entry : entry.plugin) !== Accessibility);
