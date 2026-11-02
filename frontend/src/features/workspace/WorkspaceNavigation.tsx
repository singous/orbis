import { Button } from "@orbis/ui/button";
import { workspaceEditionClassName, workspaceFunctionLinkClassName, workspaceFunctionMenuClassName, workspaceFunctionNavClassName, workspaceNavFooterClassName } from "./workspace-navigation-styles";
import { releaseFeatures } from "../../shared/release-features";
import { StickyNote } from "@orbis/ui/icons";
import { BookOpen, ChevronDown, ChevronRight, Clock3, Globe, Home, Pin, Search, Settings, Trash2, Users } from "../../shared/ui/icons";
import { type ReactNode, useId, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { useSearchPalette } from "../search/search-palette-context";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useNotebooks } from "../documents/queries";
import { canManageWorkspaceMembers } from "./capabilities";
import { usePinnedNotebooks } from "../documents/pinned-notebooks";
import { resolveWorkspaceArea } from "./workspace-areas";

const documentLinks = [
  { to: "/documents", label: "开始", icon: Clock3 },
  { to: "/documents/quick-notes", label: "随手记", icon: StickyNote },
  { to: "/documents/recent", label: "最近编辑", icon: Clock3 },
];
const navClass = ({ isActive }: { isActive: boolean }) => workspaceFunctionLinkClassName({ isActive });

function MenuFrame({ label, children, footer }: { label: string; children: ReactNode; footer?: ReactNode }) {
  return <nav className={workspaceFunctionMenuClassName} aria-label={label}>
    <div className={workspaceFunctionNavClassName}>{children}</div>
    <div className={workspaceNavFooterClassName}>{footer}<span className={workspaceEditionClassName}>Orbis · 让知识有迹可循</span></div>
  </nav>;
}

/** Mount document data hooks only while the document area owns this menu. */
function DocumentNavigation() {
  const { isOpen, openSearch } = useSearchPalette();
  const workspace = useStore(authStore, (state) => state.workspace);
  const notebooks = useNotebooks();
  const { isPinned } = usePinnedNotebooks(workspace?.id);
  const [expanded, setExpanded] = useState(true);
  const notebooksId = useId();
  const allNotebooks = notebooks.data?.items ?? [];
  const items = allNotebooks.filter(notebook => isPinned(notebook.id));

  return <MenuFrame label="文档导航" footer={<NavLink to="/documents/archive" className={navClass}><Trash2 size={18} aria-hidden="true" />回收站</NavLink>}>
    <Button type="button" className={workspaceFunctionLinkClassName({ className: "document-menu-search mb-3" })} aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch({ type: "document" })} variant="ghost"><Search size={18} aria-hidden="true" />搜索文档</Button>
    {documentLinks.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={navClass}><Icon size={18} aria-hidden="true" />{label}</NavLink>)}
    <div className="document-notebooks-heading mt-6 flex items-center gap-1 [&>button]:flex-1 [&>button[aria-expanded=false]>svg]:-rotate-90">
      <Button type="button" className={workspaceFunctionLinkClassName()} aria-label={expanded ? "收起常用笔记本" : "展开常用笔记本"} aria-expanded={expanded} aria-controls={notebooksId} onClick={() => setExpanded(value => !value)} variant="ghost"><ChevronDown size={16} aria-hidden="true" /><span>常用笔记本</span></Button>
      <NavLink to="/documents/collections" className="document-notebooks-manage grid size-(--ob-control-height-sm) flex-none place-items-center rounded-xl text-(--muted-foreground) hover:bg-(--accent) hover:text-foreground" aria-label="管理笔记本" title="管理笔记本"><ChevronRight size={16} aria-hidden="true" /></NavLink>
    </div>
    <div id={notebooksId} className="document-notebooks-list grid gap-1 [&[hidden]]:hidden [&>.workspace-function-link]:pl-6" hidden={!expanded}>
      {notebooks.isLoading ? <span className="document-notebooks-status flex items-center justify-between px-3 py-2 text-xs text-(--muted-foreground)" role="status">正在加载笔记本…</span> : null}

      {!notebooks.isLoading && !notebooks.isError && !items.length ? <Link to={allNotebooks.length ? "/documents" : "/documents/collections"} className={workspaceFunctionLinkClassName()}><BookOpen size={18} aria-hidden="true" />{allNotebooks.length ? "设置常用笔记本" : "创建第一个笔记本"}</Link> : null}
      {items.map((notebook) => <NavLink key={notebook.id} to={`/collections/${notebook.id}`} className={navClass}><NotebookIcon icon={notebook.icon} size="sm" /><span className="truncate">{notebook.title}</span>{isPinned(notebook.id) ? <Pin className="document-notebook-pin ml-auto text-(--muted-foreground)" size={13} aria-hidden="true" /> : null}</NavLink>)}
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
    case "documents": return <DocumentNavigation />;
    case "settings": return <SettingsNavigation />;
    case "sites": return releaseFeatures.sites ? <MenuFrame label={area.navigationLabel}><NavLink to="/sites" className={navClass}><Globe size={18} />我的站点</NavLink></MenuFrame> : null;
    case "home": return <MenuFrame label={area.navigationLabel}><NavLink to="/home" end className={navClass}><Home size={18} />工作台</NavLink></MenuFrame>;
    case "search": return null;
  }
}
