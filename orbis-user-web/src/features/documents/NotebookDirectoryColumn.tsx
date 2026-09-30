import { useEffect, useState, type ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ChevronsLeft, ChevronsRight } from "../../shared/ui/icons";
import { SidebarResizeHandle } from "../workspace/SidebarResizeHandle";
import { SIDEBAR_MIN_WIDTH } from "../workspace/use-sidebar-resize";

const DEFAULT_WIDTH = 260;
const MAX_WIDTH = 420;
const STORAGE_KEY = "orbis.notebookDirectoryWidth";
const MIN_CONTENT_WIDTH = 360;
const GLOBAL_NAVIGATION_WIDTH = 58;
const WORKSPACE_GUTTER_WIDTH = 30;

export function NotebookDirectoryColumn({ children, collapsed, onToggle }: { children: ReactNode; collapsed: boolean; onToggle: () => void }) {
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try { const value = Number(localStorage.getItem(STORAGE_KEY)); return value >= SIDEBAR_MIN_WIDTH && value <= MAX_WIDTH ? value : DEFAULT_WIDTH; }
    catch { return DEFAULT_WIDTH; }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => {
    const update = () => setViewport(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const maximum = Math.max(SIDEBAR_MIN_WIDTH, Math.min(MAX_WIDTH, viewport - GLOBAL_NAVIGATION_WIDTH - WORKSPACE_GUTTER_WIDTH - MIN_CONTENT_WIDTH));
  const width = Math.min(maximum, preferredWidth);
  const accept = (value: number) => {
    const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maximum, value));
    setPreferredWidth(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Keep the current session usable when storage is unavailable. */ }
  };
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  return <aside id="notebook-directory" className="notebook-directory-column" aria-label="笔记本目录栏" style={{ width: collapsed ? 0 : width }}>
    <ActionButton hidden={collapsed} type="button" className="notebook-directory-toggle" aria-label={collapsed ? "展开笔记本目录" : "收起笔记本目录"} aria-expanded={!collapsed} aria-controls="notebook-directory-body" onClick={onToggle}><Icon size={16} /></ActionButton>
    <div id="notebook-directory-body" className="notebook-directory-body" hidden={collapsed}>{children}</div>
    {!collapsed ? <SidebarResizeHandle width={width} maximum={maximum} preview={setPreferredWidth} commit={accept} reset={() => accept(DEFAULT_WIDTH)} begin={() => { const original = preferredWidth; return () => setPreferredWidth(original); }} label="调整笔记本目录宽度" controls="notebook-directory" /> : null}
  </aside>;
}
