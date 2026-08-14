import type { ReactNode } from "react";
import { Menu, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { BusinessRail } from "./BusinessRail";

export type WorkspaceShellProps = {
  children: ReactNode;
  sectionTitle?: ReactNode;
  sectionMenu?: ReactNode;
  toolbar?: ReactNode;
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
};

const compactNavigationQuery = "(max-width: 1023px)";
const RAIL_PINNED_KEY = "orbis.railExpanded";

function readRailPinned(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(RAIL_PINNED_KEY) === "1";
}

function useCompactNavigation(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(compactNavigationQuery).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(compactNavigationQuery);
    const updateCompact = () => setCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    return () => media.removeEventListener("change", updateCompact);
  }, []);

  return compact;
}

export function WorkspaceShell({ children, sectionTitle, sectionMenu, toolbar, contextPanel, contextOpen = true, onOpenContext }: WorkspaceShellProps) {
  const [mainNavigationOpen, setMainNavigationOpen] = useState(false);
  const [documentContextOpen, setDocumentContextOpen] = useState(false);
  const [railPinned, setRailPinned] = useState(readRailPinned);
  const compact = useCompactNavigation();
  const documentContextExpanded = documentContextOpen && contextOpen;
  // The toolbar strip only earns its vertical space when it carries content:
  // mobile always needs it for the drawer controls; desktop shows it for a
  // section label, page toolbar actions, or a closed context panel's reopen
  // control. Pages with a PageContainer header get no redundant empty strip.
  const showToolbar = compact || Boolean(sectionTitle) || Boolean(toolbar) || Boolean(contextPanel && onOpenContext);
  // Unpinned on desktop: the rail floats over a reserved 68px strip and
  // expands on hover. Compact keeps the drawer pattern instead.
  const railFloating = !compact && !railPinned;

  useEffect(() => {
    window.localStorage.setItem(RAIL_PINNED_KEY, railPinned ? "1" : "0");
  }, [railPinned]);

  function openMainNavigation() {
    setMainNavigationOpen(true);
    setDocumentContextOpen(false);
  }

  function openDocumentContext() {
    onOpenContext?.();
    setDocumentContextOpen(true);
    setMainNavigationOpen(false);
  }

  function closeMainNavigationAfterLink(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setMainNavigationOpen(false);
    }
  }

  function closeDocumentContextAfterLink(event: React.MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) {
      setDocumentContextOpen(false);
    }
  }

  return (
    <main className={`workspace-shell${sectionMenu ? " has-section-menu" : ""}${railFloating ? " rail-floating" : ""}${mainNavigationOpen ? " main-navigation-open" : ""}${documentContextExpanded ? " document-context-drawer-open" : ""}`}>
      <div className="workspace-shell-grid">
        <div className="workspace-main-navigation" aria-hidden={compact && !mainNavigationOpen ? true : undefined} inert={compact && !mainNavigationOpen ? true : undefined} onClick={closeMainNavigationAfterLink}>
          <BusinessRail pinned={railPinned} compact={compact} onTogglePinned={() => setRailPinned((value) => !value)} />
          {sectionMenu}
        </div>
        <section className={`workspace-main-area ${contextPanel && contextOpen ? "has-context" : ""}`} aria-label="主工作区">
          <section className="workspace-content">
            {showToolbar ? (
              <header className="workspace-toolbar">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-[var(--muted)]">
                  <button type="button" aria-label="打开主导航" aria-expanded={mainNavigationOpen} className="workspace-mobile-drawer-control" onClick={openMainNavigation}><Menu aria-hidden="true" size={16} /></button>
                  {sectionTitle ? <span>{sectionTitle}</span> : null}
                </div>
                {contextPanel ? <button type="button" aria-label="打开文档目录" aria-expanded={documentContextExpanded} className="workspace-mobile-drawer-control" onClick={openDocumentContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
                {contextPanel && onOpenContext ? <button type="button" aria-label="打开上下文面板" className="icon-button workspace-context-open-control" onClick={onOpenContext}><PanelRightOpen aria-hidden="true" size={16} /></button> : null}
                {toolbar}
              </header>
            ) : null}
            {children}
          </section>
          {contextPanel ? <aside className="workspace-context-panel" aria-label="上下文面板" aria-hidden={compact && !documentContextExpanded ? true : undefined} inert={compact && !documentContextExpanded ? true : undefined} hidden={!contextOpen} onClick={closeDocumentContextAfterLink}>{contextPanel}</aside> : null}
        </section>
      </div>
    </main>
  );
}
