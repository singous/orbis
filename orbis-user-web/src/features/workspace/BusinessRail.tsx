import type { ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { BookOpen, ChevronsRight, Globe, Home, LibraryBig, Orbit, Search, Settings, Sparkles, X } from "../../shared/ui/icons";
import { Link, useLocation } from "react-router-dom";

import { Tooltip } from "../../shared/ui/Tooltip";
import type { AppSurface } from "../../shared/platform/app-surface";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { WorkspaceAccountMenu } from "./WorkspaceAccountMenu";
import { useSearchPalette } from "../search/search-palette-context";
import { DEFAULT_WORKSPACE_PATH, resolveWorkspaceArea, WORKSPACE_AREAS, type WorkspaceAreaId } from "./workspace-areas";

type BusinessRailProps = { surface?: AppSurface; collapsed: boolean; onExpand: () => void; onClose?: () => void; createMenu?: ReactNode; expandLabel?: string };

const areaIcons = {
  home: Home,
  documents: BookOpen,
  sites: Globe,
  knowledge: LibraryBig,
  memory: Sparkles,
  settings: Settings,
  search: Search,
} satisfies Record<WorkspaceAreaId, typeof Home>;
const areas = WORKSPACE_AREAS.filter((area) => area.visibleInRail);

export function BusinessRail({ surface = "web", collapsed, onExpand, onClose, createMenu, expandLabel = "展开侧栏" }: BusinessRailProps) {
  const { pathname } = useLocation();
  const { isOpen, openSearch } = useSearchPalette();
  const activeArea = resolveWorkspaceArea(pathname);
  const searchActive = activeArea.id === "search";
  return (
    <aside className="workspace-business-rail" aria-label="应用导航">
      {onClose ? <ActionButton className="rail-action rail-mobile-close" type="button" aria-label="关闭侧栏" onClick={onClose}><X size={20} /></ActionButton> : null}
      <div className="rail-expand-slot" data-visible={collapsed} aria-hidden={!collapsed ? true : undefined} inert={!collapsed ? true : undefined}>
        <Tooltip label={expandLabel} side="right"><ActionButton className="rail-action rail-expand" data-sidebar-toggle="expand" type="button" aria-label={expandLabel} onClick={onExpand}><ChevronsRight size={20} /></ActionButton></Tooltip>
      </div>
      {surface === "web" ? <WorkspaceSwitcher variant="rail" /> : <Link to={DEFAULT_WORKSPACE_PATH} className="rail-brand" aria-label="Orbis 首页"><Orbit size={28} strokeWidth={1.8} /></Link>}
      {createMenu ? <div className="rail-create-entry">{createMenu}</div> : null}
      <Tooltip label="全局搜索" side="right"><ActionButton type="button" aria-label="搜索" aria-haspopup="dialog" aria-expanded={isOpen} aria-current={searchActive ? "page" : undefined} className={`rail-action${searchActive || isOpen ? " is-active" : ""}`} onClick={() => openSearch()}><Search aria-hidden="true" size={20} /></ActionButton></Tooltip>
      <nav className="workspace-business-nav" aria-label="业务板块">
        {areas.map(({ id, label, href }) => {
          const Icon = areaIcons[id];
          const active = activeArea.id === id;
          return (
          <Tooltip key={id} label={label} side="right">
            <Link to={href} aria-label={label} aria-current={active ? "page" : undefined} className={`rail-action${active ? " is-active" : ""}`} onClick={(event) => {
              if (active && collapsed && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                onExpand();
              }
            }}><Icon aria-hidden="true" size={20} /></Link>
          </Tooltip>
          );
        })}
      </nav>
      <div className="rail-bottom">
        {surface === "web" ? <WorkspaceAccountMenu variant="rail" /> : <Tooltip label="账号设置" side="right"><Link to="/settings/account" aria-label="账号设置" aria-current={activeArea.id === "settings" ? "page" : undefined} className={`rail-action${activeArea.id === "settings" ? " is-active" : ""}`}><Settings size={20} /></Link></Tooltip>}
      </div>
    </aside>
  );
}
