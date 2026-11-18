import { useMediaQuery } from "./use-media-query";

const COMPACT_NAVIGATION_QUERY = "(max-width: 767px)";

/** Navigation and its menus use the same responsive boundary. */
export function useCompactNavigation(): boolean {
  return useMediaQuery(COMPACT_NAVIGATION_QUERY);
}
