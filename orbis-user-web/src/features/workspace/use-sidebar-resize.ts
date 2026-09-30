import { DEFAULT_SIDEBAR_PREFERENCES, type SidebarPreferences } from "./workspace-sidebar-config";
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const MAIN_MIN_WIDTH = 360;
const DEFAULT_SIDEBAR_WIDTH = 232;
const DEFAULT_RAIL_WIDTH = 58;

function clampWidth(width: number, maximum: number) {
  return Math.round(Math.min(maximum, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function readPreferredWidth(key: string, maximum: number): number | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return null;
    const width = Number(stored);
    return Number.isFinite(width) && width >= SIDEBAR_MIN_WIDTH && width <= maximum ? width : null;
  } catch { return null; }
}

export function useSidebarResize(gridRef: RefObject<HTMLDivElement | null>, enabled: boolean, hasContext: boolean, preferences: SidebarPreferences = DEFAULT_SIDEBAR_PREFERENCES) {
  const key = preferences.widthKey;
  const [stored, setStored] = useState(() => ({ key, width: readPreferredWidth(key, SIDEBAR_MAX_WIDTH) }));
  const preferredWidth = stored.key === key ? stored.width : readPreferredWidth(key, SIDEBAR_MAX_WIDTH);
  const setPreferredWidth = (width: number | null) => setStored({ key, width });

  useLayoutEffect(() => {
    setStored(current => current.key === key ? current : { key, width: readPreferredWidth(key, SIDEBAR_MAX_WIDTH) });
  }, [key]);
  const [bounds, setBounds] = useState({ defaultWidth: DEFAULT_SIDEBAR_WIDTH, maximum: SIDEBAR_MAX_WIDTH });

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!enabled || !grid) return;
    const context = grid.querySelector<HTMLElement>(".workspace-context-panel:not([hidden])");
    function measure() {
      if (!grid || !grid.clientWidth) return;
      const styles = getComputedStyle(grid);
      const rail = parseFloat(styles.getPropertyValue("--rail-width")) || DEFAULT_RAIL_WIDTH;
      const defaultWidth = parseFloat(styles.getPropertyValue("--sidebar-default-width")) || DEFAULT_SIDEBAR_WIDTH;
      const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const gap = parseFloat(styles.columnGap) || 0;
      const contextWidth = context?.getBoundingClientRect().width ?? 0;
      const maximum = clampWidth(grid.clientWidth - padding - gap - rail - MAIN_MIN_WIDTH - contextWidth, SIDEBAR_MAX_WIDTH);
      setBounds((current) => current.defaultWidth === defaultWidth && current.maximum === maximum ? current : { defaultWidth, maximum });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    if (context) observer.observe(context);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [gridRef, enabled, hasContext]);

  const maximum = bounds.maximum;
  const width = clampWidth(preferredWidth ?? bounds.defaultWidth, maximum);
  const style: CSSProperties & { "--sidebar-width": string } = { "--sidebar-width": `${width}px` };

  function preview(next: number) { setPreferredWidth(clampWidth(next, maximum)); }
  function commit(next: number) {
    const accepted = clampWidth(next, maximum);
    setPreferredWidth(accepted);
    try { localStorage.setItem(key, String(accepted)); } catch { /* Resizing remains available without persistent storage. */ }
  }
  function reset() {
    setPreferredWidth(null);
    try { localStorage.removeItem(key); } catch { /* The default width still applies for this session. */ }
  }
  function begin() {
    const previous = preferredWidth;
    return () => setPreferredWidth(previous);
  }

  return { width, maximum, style, preview, commit, reset, begin };
}
