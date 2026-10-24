import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import type { SearchFilters } from "./api";
import { PalettePresenceObserver } from "./palette-presence";
import { GlobalSearchPalette } from "./GlobalSearchPalette";
import { captureSearchReturnContext } from "./search-return-context";

type SearchPaletteContextValue = {
  isOpen: boolean;
  openSearch: (initial?: Partial<SearchFilters>) => void;
  closeSearch: () => void;
};
const SearchPaletteContext = createContext<SearchPaletteContextValue | null>(null);

class PaletteBoundary extends Component<{ children: ReactNode; isOpen: boolean; onClose: () => void; onExited: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Dialog open={this.props.isOpen} onOpenChange={open => { if (!open) this.props.onClose(); }}>
      <DialogContent title="搜索暂时无法显示" description="当前页面仍然保留，请关闭搜索后重试。">
        <PalettePresenceObserver onExited={this.props.onExited} />
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
  const sequence = useRef(0);
  const [request, setRequest] = useState<{ id: number; open: boolean; initial: Partial<SearchFilters>; sessionKey: string; locationKey: string } | null>(null);
  const currentRequest = useRef(request);
  currentRequest.current = request;
  const currentScope = useRef({ sessionKey, locationKey });
  currentScope.current = { sessionKey, locationKey };
  const restoreFrames = useRef<number[]>([]);
  const openSearch = useCallback((initial: Partial<SearchFilters> = {}) => {
    returnContext.current ??= { sessionKey, locationKey, restore: captureSearchReturnContext() };
    setRequest({ id: ++sequence.current, open: true, initial, sessionKey, locationKey });
  }, [sessionKey, locationKey]);
  const closeSearch = useCallback(() => setRequest(current => current?.open ? { ...current, open: false } : current), []);
  useEffect(() => {
    setRequest(current => current && (current.sessionKey !== sessionKey || current.locationKey !== locationKey) ? null : current);
  }, [sessionKey, locationKey]);
  const retained = request !== null && request.sessionKey === sessionKey && request.locationKey === locationKey;
  const isOpen = retained && request.open;
  const finishExit = useCallback((id: number) => {
    const current = currentRequest.current;
    if (!current || current.id !== id || current.open) return;
    const context = returnContext.current;
    for (const frame of restoreFrames.current) cancelAnimationFrame(frame);
    restoreFrames.current = [];
    // 等待 React Aria 的焦点恢复，再还原编辑选区和滚动；不猜测 CSS 退场时长。
    restoreFrames.current.push(requestAnimationFrame(() => {
      restoreFrames.current.push(requestAnimationFrame(() => {
        restoreFrames.current = [];
        const latest = currentRequest.current;
        const scope = currentScope.current;
        if (!latest || latest.id !== id || latest.open) return;
        if (context && context.sessionKey === scope.sessionKey && context.locationKey === scope.locationKey) context.restore();
        if (returnContext.current === context) returnContext.current = null;
        setRequest(value => value?.id === id && !value.open ? null : value);
      }));
    }));
  }, []);
  useEffect(() => () => { for (const frame of restoreFrames.current) cancelAnimationFrame(frame); }, []);
  useLayoutEffect(() => {
    const context = returnContext.current;
    if (!context) return;
    if (context.sessionKey !== sessionKey || context.locationKey !== locationKey) {
      returnContext.current = null;
      return;
    }
  }, [sessionKey, locationKey]);
  const value = useMemo(() => ({ isOpen, openSearch, closeSearch }), [isOpen, openSearch, closeSearch]);
  return <SearchPaletteContext.Provider value={value}>
    {children}
    {retained ? <PaletteBoundary key={request.id} isOpen={isOpen} onClose={closeSearch} onExited={() => finishExit(request.id)}><GlobalSearchPalette initialFilters={request.initial} isOpen={isOpen} onClose={closeSearch} onExited={() => finishExit(request.id)} /></PaletteBoundary> : null}
  </SearchPaletteContext.Provider>;
}

export function useSearchPalette(): SearchPaletteContextValue {
  const context = useContext(SearchPaletteContext);
  if (!context) throw new Error("Search palette requires its workspace provider");
  return context;
}
