import { StickyNote } from "lucide-react";
import { BookOpen, ChevronDown, ChevronRight, Clock3, Globe, Home, Pin, Search, Settings, Trash2, Users } from "../../shared/ui/icons";
import { type ReactNode, useId, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";
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
const navClass = ({ isActive }: { isActive: boolean }) => `workspace-function-link${isActive ? " is-active" : ""}`;

function MenuFrame({ label, children, footer }: { label: string; children: ReactNode; footer?: ReactNode }) {
  return <nav className="workspace-function-menu" aria-label={label}>
    <div className="workspace-function-nav">{children}</div>
    <div className="workspace-nav-footer">{footer}<span className="workspace-edition">Orbis · 让知识有迹可循</span></div>
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
  const items = [...(notebooks.data?.items ?? [])].sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)));

  return <MenuFrame label="文档导航" footer={<NavLink to="/documents/archive" className={navClass}><Trash2 size={18} aria-hidden="true" />回收站</NavLink>}>
    <ActionButton type="button" className="workspace-function-link document-menu-search" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch({ type: "document" })}><Search size={18} aria-hidden="true" />搜索文档</ActionButton>
    {documentLinks.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={navClass}><Icon size={18} aria-hidden="true" />{label}</NavLink>)}
    <div className="document-notebooks-heading">
      <ActionButton type="button" className="workspace-function-link" aria-label={expanded ? "收起笔记本" : "展开笔记本"} aria-expanded={expanded} aria-controls={notebooksId} onClick={() => setExpanded(value => !value)}><ChevronDown size={16} aria-hidden="true" /><span>笔记本</span></ActionButton>
      <NavLink to="/documents/collections" className="document-notebooks-manage" aria-label="管理笔记本" title="管理笔记本"><ChevronRight size={16} aria-hidden="true" /></NavLink>
    </div>
    <div id={notebooksId} className="document-notebooks-list" hidden={!expanded}>
      {notebooks.isLoading ? <span className="document-notebooks-status" role="status">正在加载笔记本…</span> : null}

      {!notebooks.isLoading && !notebooks.isError && !items.length ? <NavLink to="/documents/collections" className={navClass}><BookOpen size={18} aria-hidden="true" />创建第一个笔记本</NavLink> : null}
      {items.map((notebook) => <NavLink key={notebook.id} to={`/collections/${notebook.id}`} className={navClass}><NotebookIcon icon={notebook.icon} size="sm" /><span className="truncate">{notebook.title}</span>{isPinned(notebook.id) ? <Pin className="document-notebook-pin" size={13} aria-hidden="true" /> : null}</NavLink>)}
    </div>
  </MenuFrame>;
}

function SettingsNavigation() {
  const workspace = useStore(authStore, (state) => state.workspace);
  return <MenuFrame label="设置导航">
    <span className="workspace-nav-label">我的设置</span>
    <NavLink to="/settings/account" className={navClass}><Settings size={18} />个人资料</NavLink>
    {canManageWorkspaceMembers(workspace) ? <><span className="workspace-nav-label">工作空间</span><NavLink to="/settings/members" className={navClass}><Users size={18} />成员管理</NavLink></> : null}
  </MenuFrame>;
}

export function WorkspaceNavigation() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);

  switch (area.id) {
    case "documents": return <DocumentNavigation />;
    case "settings": return <SettingsNavigation />;
    case "sites": return <MenuFrame label={area.navigationLabel}><NavLink to="/sites" className={navClass}><Globe size={18} />我的站点</NavLink></MenuFrame>;
    case "home": return <MenuFrame label={area.navigationLabel}><NavLink to="/home" end className={navClass}><Home size={18} />工作台</NavLink></MenuFrame>;
    case "search": return null;
  }
}
