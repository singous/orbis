import { useEffect, useState } from "react";

const COMPACT_NAVIGATION_QUERY = "(max-width: 767px)";

/** Navigation and its menus use the same responsive boundary. */
export function useCompactNavigation(): boolean {
  const [compact, setCompact] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(COMPACT_NAVIGATION_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(COMPACT_NAVIGATION_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return compact;
}
