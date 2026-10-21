import { useEffect, useRef, useState } from "react";

const PRELOAD_MARGIN = "320px";
const waiting = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

/** A shared observer also defers resources inside display:none tab panels. */
function observe(element: Element, ready: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    // The fallback keeps older browsers usable. Modern browsers use actual
    // intersections, including visibility changes when a tab is selected.
    ready();
    return () => {};
  }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      waiting.get(entry.target)?.();
      waiting.delete(entry.target);
      observer?.unobserve(entry.target);
    }
  }, { rootMargin: PRELOAD_MARGIN });
  waiting.set(element, ready);
  observer.observe(element);
  return () => {
    waiting.delete(element);
    observer?.unobserve(element);
    if (!waiting.size) { observer?.disconnect(); observer = undefined; }
  };
}

export function useResourceVisibility(resourceKey: string, enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    return observe(ref.current, () => setVisibleKey(resourceKey));
  }, [enabled, resourceKey]);
  return { ref, visible: enabled && visibleKey === resourceKey };
}
