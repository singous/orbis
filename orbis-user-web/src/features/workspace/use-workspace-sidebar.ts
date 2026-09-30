import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { SidebarPreferences } from "./workspace-sidebar-config";

const SIDEBAR_TRANSITION_FALLBACK_MS = 280;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readCollapsed(key: string) {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

/** Collapse persistence and focus follow the same lifecycle for every menu. */
export function useWorkspaceSidebar(preferences: SidebarPreferences, compact: boolean, navigationRef: RefObject<HTMLDivElement | null>) {
  const key = preferences.collapsedKey;
  const [stored, setStored] = useState(() => ({ key, collapsed: readCollapsed(key) }));
  const [animating, setAnimating] = useState(false);
  const toggleRequested = useRef(false);
  const collapsed = stored.key === key ? stored.collapsed : readCollapsed(key);

  useLayoutEffect(() => {
    setStored(current => current.key === key ? current : { key, collapsed: readCollapsed(key) });
    setAnimating(false);
    toggleRequested.current = false;
  }, [key]);

  function changeCollapsed(next: boolean) {
    toggleRequested.current = true;
    setAnimating(!compact && !window.matchMedia?.(REDUCED_MOTION_QUERY).matches);
    setStored({ key, collapsed: next });
    try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* Keep navigation usable without persistent storage. */ }
  }

  useLayoutEffect(() => {
    if (!toggleRequested.current || compact) return;
    toggleRequested.current = false;
    navigationRef.current?.querySelector<HTMLButtonElement>(`[data-sidebar-toggle="${collapsed ? "expand" : "collapse"}"]`)?.focus({ preventScroll: true });
  }, [collapsed, compact, navigationRef]);

  useEffect(() => {
    if (!animating) return;
    // Also settle rapid reversals where transitionend is cancelled.
    const timer = window.setTimeout(() => setAnimating(false), SIDEBAR_TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed, animating]);

  return { collapsed, animating, changeCollapsed };
}
