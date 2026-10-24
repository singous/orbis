import { useEffect, useRef } from "react";

/** 放在真实浮层子树中，由 HeroUI 完成退场并卸载后通知会话拥有者。 */
export function PalettePresenceObserver({ onExited }: { onExited: () => void }) {
  const callback = useRef(onExited);
  callback.current = onExited;
  useEffect(() => () => callback.current(), []);
  return null;
}
