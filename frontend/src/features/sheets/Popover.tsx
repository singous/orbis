import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const ANCHOR_GAP = 6;
const VIEWPORT_MARGIN = 8;
const FOCUSABLE = [
  'input:not([disabled]):not([type="hidden"])',
  "textarea:not([disabled])",
  "button:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");
const NESTED_OVERLAY = ".orbis-select-popover, .orbis-color-popover";

export type Anchor = { left: number; top: number; element?: HTMLElement };
export function anchorAt(element: Element): Anchor {
  const r = element.getBoundingClientRect();
  return {
    left: r.left,
    top: r.bottom + ANCHOR_GAP,
    element: element instanceof HTMLElement ? element : undefined,
  };
}
export function Popover({
  anchor,
  label,
  children,
  onClose,
  wide = false,
  className = "",
  anchorElement,
  onEscape,
  onTab,
}: {
  anchor: Anchor;
  label: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  anchorElement?: HTMLElement | null;
  onEscape?: () => void;
  onTab?: (backward: boolean) => void;
}) {
  const handlers = useRef({ onClose, onEscape, anchorElement });
  handlers.current = { onClose, onEscape, anchorElement };
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: anchor.left,
    top: anchor.top,
    maxWidth: innerWidth - 2 * VIEWPORT_MARGIN,
    maxHeight: innerHeight - 2 * VIEWPORT_MARGIN,
  });
  const dismissal = useRef<"restore" | "outside" | "managed">("restore");

  // Capture the trigger before moving focus, including menus that open another editor.
  useLayoutEffect(() => {
    const el = ref.current!;
    const previous = anchorElement ?? anchor.element ?? document.activeElement;
    const first = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
      (item) => item.tabIndex >= 0 &&
        !item.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]'),
    );
    (first ?? el).focus({ preventScroll: true });
    return () => {
      if (
        dismissal.current === "restore" &&
        previous instanceof HTMLElement && previous.isConnected
      ) {
        previous.focus();
      }
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current!;
    let frame = 0;
    const place = () => {
      frame = 0;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + VIEWPORT_MARGIN;
      const top = (viewport?.offsetTop ?? 0) + VIEWPORT_MARGIN;
      const maxWidth = Math.max(
        0, (viewport?.width ?? innerWidth) - 2 * VIEWPORT_MARGIN,
      );
      const maxHeight = Math.max(
        0, (viewport?.height ?? innerHeight) - 2 * VIEWPORT_MARGIN,
      );
      const trigger = anchorElement ?? anchor.element;
      const rect = trigger?.isConnected ? trigger.getBoundingClientRect() : undefined;
      const anchorLeft = rect?.left ?? anchor.left;
      const anchorTop = rect ? rect.bottom + ANCHOR_GAP : anchor.top;
      const maxLeft = left + maxWidth - Math.min(el.offsetWidth, maxWidth);
      const maxTop = top + maxHeight - Math.min(el.offsetHeight, maxHeight);
      const next = {
        left: Math.max(left, Math.min(anchorLeft, maxLeft)),
        top: Math.max(top, Math.min(anchorTop, maxTop)),
        maxWidth,
        maxHeight,
      };
      setPosition((old) => {
        if (old.left === next.left && old.top === next.top &&
          old.maxWidth === maxWidth && old.maxHeight === maxHeight) return old;
        return next;
      });
    };
    const schedule = (event?: Event) => {
      if (event?.target instanceof Node && el.contains(event.target)) return;
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const observer = new ResizeObserver(() => schedule());
    observer.observe(el);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchor, anchorElement]);

  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(NESTED_OVERLAY)) return;
      if (
        !ref.current?.contains(e.target as Node) &&
        !handlers.current.anchorElement?.contains(e.target as Node)
      ) {
        dismissal.current = "outside";
        handlers.current.onClose();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.isComposing && !e.defaultPrevented &&
        !(e.target instanceof Element && e.target.closest(NESTED_OVERLAY))
      ) {
        e.preventDefault();
        e.stopPropagation();
        dismissal.current = handlers.current.onEscape ? "managed" : "restore";
        (handlers.current.onEscape ?? handlers.current.onClose)();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      tabIndex={-1}
      aria-label={label}
      className={`sheet-popover${wide ? " wide" : ""} ${className}`}
      style={position}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Tab" && onTab) {
          e.preventDefault();
          dismissal.current = "managed";
          onTab(e.shiftKey);
          return;
        }
        const menu = (e.target as HTMLElement).closest('[role="menu"]');
        if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const items = Array.from(
            menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          );
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
