import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import type { SearchFilters } from "./api";
import { GlobalSearchPalette } from "./GlobalSearchPalette";
import { captureSearchReturnContext } from "./search-return-context";

type SearchPaletteContextValue = {
  isOpen: boolean;
  openSearch: (initial?: Partial<SearchFilters>) => void;
  closeSearch: () => void;
};
const SearchPaletteContext = createContext<SearchPaletteContextValue | null>(null);

class PaletteBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Dialog open onOpenChange={open => { if (!open) this.props.onClose(); }}>
      <DialogContent title="搜索暂时无法显示" description="当前页面仍然保留，请关闭搜索后重试。">
        <Button onClick={this.props.onClose}>关闭搜索</Button>
      </DialogContent>
    </Dialog> : this.props.children;
  }
}

/** Local overlay state preserves the background route and its editing session. */
export function SearchPaletteProvider({ children }: { children: ReactNode }) {
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const { key: locationKey } = useLocation();
  const returnContext = useRef<{ sessionKey: string | null; locationKey: string; restore: () => void } | null>(null);
  const [request, setRequest] = useState<{ initial: Partial<SearchFilters>; sessionKey: string | null; locationKey: string } | null>(null);
  const openSearch = useCallback((initial: Partial<SearchFilters> = {}) => {
    returnContext.current ??= { sessionKey, locationKey, restore: captureSearchReturnContext() };
    setRequest({ initial, sessionKey, locationKey });
  }, [sessionKey, locationKey]);
  const closeSearch = useCallback(() => setRequest(null), []);
  useEffect(() => closeSearch(), [sessionKey, locationKey, closeSearch]);
  const isOpen = request !== null && request.sessionKey === sessionKey && request.locationKey === locationKey;
  useLayoutEffect(() => {
    const context = returnContext.current;
    if (!context) return;
    if (context.sessionKey !== sessionKey || context.locationKey !== locationKey) {
      returnContext.current = null;
      return;
    }
    if (isOpen) return;
    // Run after the modal's focus restoration, which can scroll a contenteditable caret.
    const frame = requestAnimationFrame(() => {
      context.restore();
      if (returnContext.current === context) returnContext.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, sessionKey, locationKey]);
  const value = useMemo(() => ({ isOpen, openSearch, closeSearch }), [isOpen, openSearch, closeSearch]);
  return <SearchPaletteContext.Provider value={value}>
    {children}
    {isOpen ? <PaletteBoundary onClose={closeSearch}><GlobalSearchPalette initialFilters={request.initial} onClose={closeSearch} /></PaletteBoundary> : null}
  </SearchPaletteContext.Provider>;
}

export function useSearchPalette(): SearchPaletteContextValue {
  const context = useContext(SearchPaletteContext);
  if (!context) throw new Error("Search palette requires its workspace provider");
  return context;
}
