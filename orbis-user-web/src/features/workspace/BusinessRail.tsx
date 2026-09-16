import { BookOpen, ChevronsRight, Globe, Home, LibraryBig, Orbit, Search, Settings, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { Tooltip } from "../../shared/ui/Tooltip";
import { resolveWorkspaceArea, WORKSPACE_AREAS, type WorkspaceAreaId } from "./workspace-areas";

type BusinessRailProps = { collapsed: boolean; onExpand: () => void };

const areaIcons = {
  home: Home,
  documents: BookOpen,
  sites: Globe,
  knowledge: LibraryBig,
  memory: Sparkles,
  settings: Settings,
} satisfies Record<WorkspaceAreaId, typeof Home>;
const areas = WORKSPACE_AREAS.filter((area) => area.id !== "settings");

export function BusinessRail({ collapsed, onExpand }: BusinessRailProps) {
  const { pathname } = useLocation();
  const activeArea = resolveWorkspaceArea(pathname);
  return (
    <aside className="workspace-business-rail" aria-label="应用导航">
      {collapsed ? <Tooltip label="展开侧栏" side="right"><button className="rail-action rail-expand" type="button" aria-label="展开侧栏" onClick={onExpand}><ChevronsRight size={19} /></button></Tooltip> : null}
      <Link to="/home" className="rail-brand" aria-label="Orbis 首页"><Orbit size={26} strokeWidth={1.8} /></Link>
      <nav className="workspace-business-nav" aria-label="业务板块">
        {areas.map(({ id, label, href }) => {
          const Icon = areaIcons[id];
          const active = activeArea.id === id;
          return (
          <Tooltip key={id} label={label} side="right">
            <Link to={href} aria-label={label} aria-current={active ? "page" : undefined} className={`rail-action${active ? " is-active" : ""}`}><Icon aria-hidden="true" size={21} strokeWidth={1.7} /></Link>
          </Tooltip>
          );
        })}
      </nav>
      <div className="rail-bottom">
        <Tooltip label="搜索" side="right"><Link to="/documents/search" aria-label="搜索" className="rail-action"><Search size={20} strokeWidth={1.7} /></Link></Tooltip>
        <Tooltip label="账号设置" side="right"><Link to="/settings/account" aria-label="账号设置" aria-current={activeArea.id === "settings" ? "page" : undefined} className={`rail-action${activeArea.id === "settings" ? " is-active" : ""}`}><Settings size={20} strokeWidth={1.7} /></Link></Tooltip>
      </div>
    </aside>
  );
}
