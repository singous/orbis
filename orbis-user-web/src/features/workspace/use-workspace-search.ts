import { useEffect } from "react";
import { useSearchPalette } from "../search/search-palette-context";

export const GLOBAL_SEARCH_INPUT_ID = "orbis-global-search-input";
const MODAL_ROLES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** One shortcut owner survives either chrome layout and respects modal focus. */
export function useWorkspaceSearch(disabled: boolean) {
  const { openSearch } = useSearchPalette();
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (disabled || event.defaultPrevented || event.isComposing || event.altKey ||
          !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" ||
          (event.target instanceof Element && event.target.closest(MODAL_ROLES))) return;
      event.preventDefault();
      openSearch();
    }
    // Claim the global shortcut before an editor flushes its DOM selection.
    document.addEventListener("keydown", handleShortcut, true);
    return () => document.removeEventListener("keydown", handleShortcut, true);
  }, [disabled, openSearch]);
}
