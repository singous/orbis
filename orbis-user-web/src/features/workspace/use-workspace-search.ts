import { useEffect, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AppSurface } from "../../shared/platform/app-surface";

export const GLOBAL_SEARCH_INPUT_ID = "orbis-global-search-input";
const MODAL_ROLES = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/** One shortcut owner survives either chrome layout and respects modal focus. */
export function useWorkspaceSearch(surface: AppSurface, disabled: boolean, desktopInput: RefObject<HTMLInputElement | null>) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (disabled || event.defaultPrevented || event.isComposing || event.altKey ||
          !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" ||
          (event.target instanceof Element && event.target.closest(MODAL_ROLES))) return;
      event.preventDefault();
      if (surface === "desktop") desktopInput.current?.focus();
      else if (pathname === "/search") document.getElementById(GLOBAL_SEARCH_INPUT_ID)?.focus();
      else navigate("/search");
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [surface, disabled, desktopInput, pathname, navigate]);
}
