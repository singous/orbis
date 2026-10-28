import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceLayoutContext } from "./workspace-layout-context";
import type { WorkspaceChrome } from "./workspace-layout";
import { resolveWorkspaceArea } from "./workspace-areas";

/** Keep application chrome mounted while route content and lazy modules change. */
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname).id;
  const [current, setCurrent] = useState<{ area: string; chrome: WorkspaceChrome }>({ area, chrome: {} });
  const owner = useRef<symbol | null>(null);
  const configure = useCallback((token: symbol, chrome: WorkspaceChrome, loading: boolean) => {
    owner.current = token;
    setCurrent(previous => ({ area, chrome: loading && previous.area === area
      ? { ...previous.chrome, toolbar: undefined, contextPanel: undefined, onOpenContext: undefined }
      : chrome }));
  }, [area]);
  const release = useCallback((token: symbol) => {
    if (owner.current !== token) return;
    owner.current = null;
    // Retain navigation during the next route's loading phase, but never keep
    // actions or panel callbacks belonging to an unmounted editor interactive.
    setCurrent(previous => ({ ...previous, chrome: { ...previous.chrome, toolbar: undefined, contextPanel: undefined, onOpenContext: undefined } }));
  }, []);
  const frame = useMemo(() => ({ configure, release }), [configure, release]);
  return <WorkspaceLayoutContext.Provider value={frame}>
    <WorkspaceLayout {...(current.area === area ? current.chrome : {})}><Fragment key={pathname}>{children}</Fragment></WorkspaceLayout>
  </WorkspaceLayoutContext.Provider>;
}
