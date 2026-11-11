import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { workspaceFunctionLinkClassName, workspaceFunctionMenuClassName, workspaceFunctionNavClassName, workspaceNavFooterClassName } from "./workspace-navigation-styles";
import { releaseFeatures } from "../../shared/release-features";
import { LayoutDashboard, StickyNote } from "@orbis/ui/icons";
import { ChevronDown, Globe, History, Home, Search, Settings, Trash2, Users } from "../../shared/ui/icons";
import { type ReactNode, useId, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { useSearchPalette } from "../search/search-palette-context";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useNotebooks } from "../documents/queries";
import { canManageWorkspaceMembers } from "./capabilities";
import { usePinnedNotebooks } from "../documents/pinned-notebooks";
import { resolveWorkspaceArea } from "./workspace-areas";

const documentLinks = [
  { to: "/home", label: "首页", icon: LayoutDashboard },
  { to: "/documents", label: "开始", icon: Home },
  { to: "/documents/quick-notes", label: "随手记", icon: StickyNote },
  { to: "/documents/recent", label: "最近编辑", icon: History },
];
const navClass = ({ isActive }: { isActive: boolean }) => workspaceFunctionLinkClassName({ isActive });

function MenuFrame({ label, children, footer }: { label: string; children: ReactNode; footer?: ReactNode }) {
  return <nav className={cn(workspaceFunctionMenuClassName, "px-4 pt-5")} aria-label={label}>
    <div className={workspaceFunctionNavClassName}>{children}</div>
    {footer ? <div className={workspaceNavFooterClassName}>{footer}</div> : null}
  </nav>;
}

/** Mount document data hooks only while the document area owns this menu. */
function DocumentNavigation() {
  const { isOpen, openSearch } = useSearchPalette();
  const workspace = useStore(authStore, (state) => state.workspace);
  const { pinned, isPinned } = usePinnedNotebooks(workspace?.id);
  const notebooks = useNotebooks(undefined, "active", { enabled: pinned.length > 0 });
  const [expanded, setExpanded] = useState(true);
  const notebooksId = useId();
  const items = notebooks.data?.items.filter(notebook => isPinned(notebook.id)) ?? [];

  return <MenuFrame label="文档导航" footer={<NavLink to="/documents/archive" className={navClass}><Trash2 size={18} aria-hidden="true" />回收站</NavLink>}>
    <Button type="button" className={workspaceFunctionLinkClassName({ className: "document-menu-search mb-3 min-h-8 bg-card" })} aria-label="搜索文档" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch({ type: "document" })} variant="ghost"><Search size={18} aria-hidden="true" />搜索文档</Button>
    {documentLinks.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={navClass}><Icon size={18} aria-hidden="true" />{label}</NavLink>)}
    <Button type="button" className={workspaceFunctionLinkClassName({ className: "document-notebooks-heading mt-4 min-h-[30px] text-xs text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-[expanded=false]:[&_svg]:-rotate-90" })} aria-label={expanded ? "收起常用笔记本" : "展开常用笔记本"} aria-expanded={expanded} aria-controls={notebooksId} onClick={() => setExpanded(value => !value)} variant="ghost">
      <ChevronDown aria-hidden="true" className="size-3.5" /><span>常用笔记本</span>
    </Button>
    <div id={notebooksId} className="document-notebooks-list grid gap-1 [&[hidden]]:hidden" hidden={!expanded}>
      {notebooks.isLoading ? <span className="document-notebooks-status px-3 py-2 text-xs text-muted-foreground" role="status">正在加载笔记本…</span> : null}
      {items.map(notebook => <NavLink key={notebook.id} to={`/collections/${notebook.id}`} className={navClass}>
        <NotebookIcon icon={notebook.icon} size="sm" /><span className="truncate">{notebook.title}</span>
      </NavLink>)}
    </div>
  </MenuFrame>;
}

function SettingsNavigation() {
  const workspace = useStore(authStore, (state) => state.workspace);
  return <MenuFrame label="设置导航">
    <span className="workspace-nav-label mt-[23px] mb-[7px] px-2.5 text-sm text-(--muted-foreground)">我的设置</span>
    <NavLink to="/settings/account" className={navClass}><Settings size={18} />个人资料</NavLink>
    {canManageWorkspaceMembers(workspace) ? <><span className="workspace-nav-label mt-[23px] mb-[7px] px-2.5 text-sm text-(--muted-foreground)">工作空间</span><NavLink to="/settings/members" className={navClass}><Users size={18} />成员管理</NavLink></> : null}
  </MenuFrame>;
}

export function WorkspaceNavigation() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);

  switch (area.id) {
    case "home":
    case "search":
    case "documents": return <DocumentNavigation />;
    case "settings": return <SettingsNavigation />;
    case "sites": return releaseFeatures.sites ? <MenuFrame label="站点导航"><NavLink to="/sites" className={navClass}><Globe size={18} />我的站点</NavLink></MenuFrame> : null;
  }
}
