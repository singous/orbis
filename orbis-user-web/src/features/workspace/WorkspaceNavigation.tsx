import { Archive, BookOpen, Clock3, Globe, Home, LibraryBig, Notebook, Search, Settings, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useNotebooks } from "../documents/queries";
import { canManageWorkspaceMembers } from "./capabilities";
import { resolveWorkspaceArea } from "./workspace-areas";

const RECENT_NOTEBOOK_LIMIT = 5;
const documentLinks = [
  { to: "/documents", label: "文档概览", icon: BookOpen },
  { to: "/documents/recent", label: "最近编辑", icon: Clock3 },
  { to: "/documents/collections", label: "我的笔记本", icon: Notebook },
  { to: "/documents/search", label: "全文搜索", icon: Search },
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
  const workspace = useStore(authStore, (state) => state.workspace);
  const notebooks = useNotebooks();
  const recentNotebooks = [...(notebooks.data?.items ?? [])]
    .sort((a, b) => b.updated_at_ms - a.updated_at_ms)
    .slice(0, RECENT_NOTEBOOK_LIMIT);

  return <MenuFrame label="文档导航" footer={<NavLink to="/documents/archive" className={navClass}><Archive size={17} />归档</NavLink>}>
    {documentLinks.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end className={navClass}><Icon size={17} />{label}</NavLink>)}
    <span className="workspace-nav-label">我的空间</span>
    <div className="workspace-nav-space"><Notebook size={17} aria-hidden="true" /><span>{workspace?.name ?? "私人工作空间"}</span></div>
    <div className="workspace-notebook-links">
      {recentNotebooks.map((notebook) => <NavLink key={notebook.id} to={`/collections/${notebook.id}`} className={navClass}><NotebookIcon icon={notebook.icon} size="sm" /><span className="truncate">{notebook.title}</span></NavLink>)}
      {!recentNotebooks.length ? <NavLink to="/documents/collections" className="workspace-function-link workspace-nav-muted"><Notebook size={16} />管理笔记本</NavLink> : null}
    </div>
  </MenuFrame>;
}

function SettingsNavigation() {
  const workspace = useStore(authStore, (state) => state.workspace);
  return <MenuFrame label="设置导航">
    <span className="workspace-nav-label">我的设置</span>
    <NavLink to="/settings/account" className={navClass}><Settings size={17} />个人资料</NavLink>
    {canManageWorkspaceMembers(workspace) ? <><span className="workspace-nav-label">工作空间</span><NavLink to="/settings/members" className={navClass}><Users size={17} />成员管理</NavLink></> : null}
  </MenuFrame>;
}

export function WorkspaceNavigation() {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname);

  switch (area.id) {
    case "documents": return <DocumentNavigation />;
    case "settings": return <SettingsNavigation />;
    case "sites": return <MenuFrame label={area.navigationLabel}><NavLink to="/sites" className={navClass}><Globe size={17} />我的站点</NavLink></MenuFrame>;
    case "knowledge": return <MenuFrame label={area.navigationLabel}><NavLink to="/knowledge" className={navClass}><LibraryBig size={17} />知识中心</NavLink></MenuFrame>;
    case "memory": return <MenuFrame label={area.navigationLabel}><NavLink to="/memory" className={navClass}><Sparkles size={17} />长期记忆</NavLink></MenuFrame>;
    case "home": return <MenuFrame label={area.navigationLabel}><NavLink to="/home" end className={navClass}><Home size={17} />工作台</NavLink></MenuFrame>;
  }
}
