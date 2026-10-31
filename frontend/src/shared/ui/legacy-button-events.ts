import { useRef, type ComponentProps, type MouseEvent } from "react";

type PressEvent = {
  type: "press";
  pointerType: "mouse" | "pen" | "touch" | "keyboard" | "virtual";
  target: Element;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  x: number;
  y: number;
  continuePropagation: () => void;
};
type LegacyButtonEvents = Pick<ComponentProps<"button">, "onClick" | "onKeyDown" | "onPointerDown"> & { onPress?: (event: PressEvent) => void };

export function useLegacyButtonEvents({ onClick, onPress, onKeyDown, onPointerDown }: LegacyButtonEvents) {
  const pointer = useRef<PressEvent["pointerType"] | null>(null);
  return {
    onKeyDown: ((event) => { if (event.key === "Enter" || event.key === " ") pointer.current = "keyboard"; onKeyDown?.(event); }) satisfies NonNullable<LegacyButtonEvents["onKeyDown"]>,
    onPointerDown: ((event) => { pointer.current = event.pointerType === "touch" || event.pointerType === "pen" ? event.pointerType : "mouse"; onPointerDown?.(event); }) satisfies NonNullable<LegacyButtonEvents["onPointerDown"]>,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      const pointerType = event.detail === 0 ? pointer.current === "keyboard" ? "keyboard" : "virtual" : pointer.current ?? "mouse";
      pointer.current = null;
      if (onPress) {
        const bounds = event.currentTarget.getBoundingClientRect();
        let propagate = false;
        onPress({ type: "press", pointerType, target: event.currentTarget, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, x: event.detail ? event.clientX - bounds.left : bounds.width / 2, y: event.detail ? event.clientY - bounds.top : bounds.height / 2, continuePropagation: () => { propagate = true; } });
        if (!propagate) event.stopPropagation();
      }
      onClick?.(event);
    },
  };
}
export type { LegacyButtonEvents };
