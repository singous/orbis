import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { SIDEBAR_MOTION_DURATION_MS } from "./workspace-sidebar-config";

const SIDEBAR_TRANSITION_SETTLE_BUFFER_MS = 40;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Collapse is local to the current navigation scope; each new page starts open. */
export function useWorkspaceSidebar(scope: string, compact: boolean, navigationRef: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState(() => ({ scope, collapsed: false }));
  const [animating, setAnimating] = useState(false);
  const toggleRequested = useRef(false);
  const collapsed = state.scope === scope ? state.collapsed : false;

  useLayoutEffect(() => {
    setState(current => current.scope === scope ? current : { scope, collapsed: false });
    setAnimating(false);
    toggleRequested.current = false;
  }, [scope]);

  function changeCollapsed(next: boolean) {
    toggleRequested.current = true;
    setAnimating(!compact && !window.matchMedia?.(REDUCED_MOTION_QUERY).matches);
    setState({ scope, collapsed: next });
  }

  useLayoutEffect(() => {
    if (!toggleRequested.current || compact) return;
    toggleRequested.current = false;
    navigationRef.current?.querySelector<HTMLButtonElement>(`[data-sidebar-toggle="${collapsed ? "expand" : "collapse"}"]`)?.focus({ preventScroll: true });
  }, [collapsed, compact, navigationRef]);

  useEffect(() => {
    if (!animating) return;
    // Also settle rapid reversals where transitionend is cancelled.
    const timer = window.setTimeout(() => setAnimating(false), SIDEBAR_MOTION_DURATION_MS + SIDEBAR_TRANSITION_SETTLE_BUFFER_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed, animating]);

  return { collapsed, animating, changeCollapsed };
}
