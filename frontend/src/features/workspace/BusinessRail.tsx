import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { railControlClassName, workspaceRailClassName } from "./workspace-chrome";
import type { ReactNode } from "react";
import { OrbisLogo } from "../../shared/ui/OrbisLogo";
import { BookOpen, ChevronsRight, Globe, Home, Search, Settings, X } from "../../shared/ui/icons";
import { Link, useLocation } from "react-router-dom";

import { Tooltip, TooltipContent, TooltipTrigger } from "@orbis/ui/tooltip";
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
    <aside className={workspaceRailClassName} aria-label="应用导航">
      {onClose ? <Button className={cn(railControlClassName, "rail-action rail-mobile-close max-[768px]:mt-[-7px] max-[768px]:mb-2.5")} type="button" aria-label="关闭侧栏" onClick={onClose} variant="ghost"><X size={20} /></Button> : null}
      <div className="rail-expand-slot h-0 w-8 flex-none overflow-hidden opacity-0 [transition:height_var(--sidebar-transition-duration)_var(--sidebar-transition-easing),opacity_var(--sidebar-transition-duration)_ease] data-[visible=true]:h-8 data-[visible=true]:opacity-100 motion-reduce:transition-none" data-visible={collapsed} aria-hidden={!collapsed ? true : undefined} inert={!collapsed ? true : undefined}>
        <Tooltip><TooltipTrigger render={<Button className={cn(railControlClassName, "rail-action rail-expand m-0")} data-sidebar-toggle="expand" type="button" aria-label={expandLabel} onClick={onExpand} variant="ghost" />}><ChevronsRight size={20} /></TooltipTrigger><TooltipContent side="right">{expandLabel}</TooltipContent></Tooltip>
      </div>
      {surface === "web" ? <WorkspaceSwitcher variant="rail" /> : <Link to={DEFAULT_WORKSPACE_PATH} className={cn(railControlClassName, "rail-brand mb-9 text-foreground in-has-[.rail-create-entry]:mb-4")} aria-label="Orbis 首页"><OrbisLogo size={32} /></Link>}
      {createMenu ? <div className="rail-create-entry mb-5">{createMenu}</div> : null}
      <nav className="workspace-business-nav flex flex-col items-center gap-4" aria-label="业务板块">
        <Tooltip><TooltipTrigger render={<Button type="button" aria-label="搜索" aria-haspopup="dialog" aria-expanded={isOpen} aria-current={searchActive ? "page" : undefined} className={cn(railControlClassName, "rail-action", (searchActive || isOpen) && "is-active")} onClick={() => openSearch()} variant="ghost" />}><Search aria-hidden="true" size={20} /></TooltipTrigger><TooltipContent side="right">{"全局搜索"}</TooltipContent></Tooltip>
        {areas.map(({ id, label, href }) => {
          const Icon = areaIcons[id];
          const active = activeArea.id === id;
          return (
          <Tooltip key={id}><TooltipTrigger render={<Link to={href} aria-label={label} aria-current={active ? "page" : undefined} className={cn(railControlClassName, "rail-action", active && "is-active")} onClick={(event) => {
              if (active && collapsed && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                onExpand();
              }
            }} />}><Icon aria-hidden="true" size={20} /></TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip>
          );
        })}
      </nav>
      <div className="rail-bottom mt-auto flex flex-col gap-2.5 pt-[30px]">
        {surface === "web" ? <WorkspaceAccountMenu variant="rail" /> : <Tooltip><TooltipTrigger render={<Link to="/settings/account" aria-label="账号设置" aria-current={activeArea.id === "settings" ? "page" : undefined} className={cn(railControlClassName, "rail-action", activeArea.id === "settings" && "is-active")} />}><Settings size={20} /></TooltipTrigger><TooltipContent side="right">{"账号设置"}</TooltipContent></Tooltip>}
      </div>
    </aside>
  );
}
