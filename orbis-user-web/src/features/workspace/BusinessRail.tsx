import type { ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { BookOpen, ChevronsRight, Globe, Home, LibraryBig, Orbit, Search, Settings, Sparkles, X } from "../../shared/ui/icons";
import { Link, useLocation } from "react-router-dom";

import { NotebookQuickAccess } from "./NotebookQuickAccess";
import { Tooltip } from "../../shared/ui/Tooltip";
import { DEFAULT_WORKSPACE_PATH, resolveWorkspaceArea, WORKSPACE_AREAS, type WorkspaceAreaId } from "./workspace-areas";

type BusinessRailProps = { collapsed: boolean; onExpand: () => void; onClose?: () => void; createMenu?: ReactNode; expandLabel?: string };

const areaIcons = {
  home: Home,
  documents: BookOpen,
  sites: Globe,
  knowledge: LibraryBig,
  memory: Sparkles,
  settings: Settings,
} satisfies Record<WorkspaceAreaId, typeof Home>;
const areas = WORKSPACE_AREAS.filter((area) => area.visibleInRail);

export function BusinessRail({ collapsed, onExpand, onClose, createMenu, expandLabel = "展开侧栏" }: BusinessRailProps) {
  const { pathname } = useLocation();
  const activeArea = resolveWorkspaceArea(pathname);
  const searchActive = pathname === "/documents/search";
  return (
    <aside className="workspace-business-rail" aria-label="应用导航">
      {onClose ? <ActionButton className="rail-action rail-mobile-close" type="button" aria-label="关闭侧栏" onClick={onClose}><X size={20} /></ActionButton> : null}
      <div className="rail-expand-slot" data-visible={collapsed} aria-hidden={!collapsed ? true : undefined} inert={!collapsed ? true : undefined}>
        <Tooltip label={expandLabel} side="right"><ActionButton className="rail-action rail-expand" data-sidebar-toggle="expand" type="button" aria-label={expandLabel} onClick={onExpand}><ChevronsRight size={20} /></ActionButton></Tooltip>
      </div>
      <Link to={DEFAULT_WORKSPACE_PATH} className="rail-brand" aria-label="Orbis 首页"><Orbit size={28} strokeWidth={1.8} /></Link>
      {createMenu ? <div className="rail-create-entry">{createMenu}</div> : null}
      <nav className="workspace-business-nav" aria-label="业务板块">
        {areas.map(({ id, label, href }) => {
          const Icon = areaIcons[id];
          const active = activeArea.id === id;
          if (id === "documents") return <NotebookQuickAccess key={id} active={active} />;
          return (
          <Tooltip key={id} label={label} side="right">
            <Link to={href} aria-label={label} aria-current={active ? "page" : undefined} className={`rail-action${active ? " is-active" : ""}`}><Icon aria-hidden="true" size={22} /></Link>
          </Tooltip>
          );
        })}
      </nav>
      <div className="rail-bottom">
        <Tooltip label="搜索" side="right"><Link to="/documents/search" aria-label="搜索" aria-current={searchActive ? "page" : undefined} className={`rail-action${searchActive ? " is-active" : ""}`}><Search size={20} /></Link></Tooltip>
        <Tooltip label="账号设置" side="right"><Link to="/settings/account" aria-label="账号设置" aria-current={activeArea.id === "settings" ? "page" : undefined} className={`rail-action${activeArea.id === "settings" ? " is-active" : ""}`}><Settings size={20} /></Link></Tooltip>
      </div>
    </aside>
  );
}
