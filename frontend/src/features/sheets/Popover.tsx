import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type Anchor = { left: number; top: number };
export function anchorAt(element: Element): Anchor {
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.bottom + 6 };
}
export function Popover({
  anchor,
  label,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  anchor: Anchor;
  label: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const el = ref.current!;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, innerWidth - el.offsetWidth - 8)),
      top: Math.max(8, Math.min(anchor.top, innerHeight - el.offsetHeight - 8)),
    });
    el.querySelector<HTMLElement>("input,button,select")?.focus();
  }, [anchor]);
  useEffect(() => {
    const previous = document.activeElement;
    const dismiss = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(".orbis-select-popover")) return;
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !(e.target as HTMLElement).closest?.(".orbis-select-popover")
      ) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key, true);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`sheet-popover${wide ? " wide" : ""} ${className}`}
      style={{ left: position.left, top: position.top }}
      onKeyDown={(e) => {
        e.stopPropagation();
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
