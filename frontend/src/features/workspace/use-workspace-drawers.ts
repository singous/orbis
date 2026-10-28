import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSearchPalette } from "../search/search-palette-context";

/** Own drawer visibility, focus and route cleanup independently of page lifetimes. */
export function useWorkspaceDrawers(compact: boolean, contextOpen: boolean) {
  const { pathname } = useLocation();
  const { isOpen: searchOpen } = useSearchPalette();
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const [mainNavigationOpen, setMainNavigationOpen] = useState(false);
  const [documentContextOpen, setDocumentContextOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLElement>(null);
  const contentScrollRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    setMainNavigationOpen(false);
    setDocumentContextOpen(false);
    if (contentScrollRef.current) { contentScrollRef.current.scrollTop = 0; contentScrollRef.current.scrollLeft = 0; }
  }, [pathname]);
  const documentContextExpanded = documentContextOpen && contextOpen;
  const drawerOpen = compact && (mainNavigationOpen || documentContextExpanded);
  useEffect(() => {
    if (!drawerOpen) return;
    const region = mainNavigationOpen ? navigationRef.current : contextRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(region?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter((element) => !element.closest("[hidden], [inert]") && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
    focusable()[0]?.focus();
    // A nested overlay may unmount earlier in the same keyboard dispatch.
    // The composed path retains its ownership even after the target detaches.
    const inNestedOverlay = (event: KeyboardEvent) => event.composedPath().some(node => node instanceof Element && node.matches('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
    // Tooltip/focusable controls stop React keyboard propagation. Capture only
    // drawer dismissal, yielding to functional overlays and input composition.
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || searchOpenRef.current || event.defaultPrevented || event.isComposing || inNestedOverlay(event)) return;
      if (event.target instanceof Node && event.target !== document.body && event.target !== document && !region?.contains(event.target)) return;
      setMainNavigationOpen(false);
      setDocumentContextOpen(false);
      event.preventDefault();
    }
    function handleKey(event: KeyboardEvent) {
      if (searchOpenRef.current || event.defaultPrevented || inNestedOverlay(event)) return;
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !region?.contains(document.activeElement))) { last?.focus(); event.preventDefault(); }
        else if (!event.shiftKey && (document.activeElement === last || !region?.contains(document.activeElement))) { first?.focus(); event.preventDefault(); }
      }
    }
    document.addEventListener("keydown", handleEscape, true);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleEscape, true); document.removeEventListener("keydown", handleKey); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [drawerOpen, mainNavigationOpen]);

  function closeAfterLink(event: React.MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setMainNavigationOpen(false);
      setDocumentContextOpen(false);
    }
  }
  return { mainNavigationOpen, setMainNavigationOpen, setDocumentContextOpen, documentContextExpanded,
    drawerOpen, navigationRef, contextRef, contentScrollRef, closeAfterLink };
}
