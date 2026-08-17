import { BookOpen, Home, LibraryBig, Pin, Search, Settings, Sparkles, StickyNote } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { useNotebooks } from "../documents/queries";
import { usePinnedNotebooks } from "../documents/pinned-notebooks";
import { authStore } from "../../shared/auth/auth-store";
import { RailCreateMenu } from "./RailCreateMenu";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/**
 * Pinned notebooks, reachable from the rail's 常用 tile as a hover popover.
 * The rail has one fixed width, so this never renders inline.
 */
function PinnedList() {
  const workspaceId = useStore(authStore, (state) => state.workspace?.id);
  const notebooksQuery = useNotebooks();
  const { pinned, togglePin } = usePinnedNotebooks(workspaceId);
  const notebooks = notebooksQuery.data?.items ?? [];
  const pinnedNotebooks = pinned
    .map((id) => notebooks.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  return (
    <div className="rail-fav-popover">
      <div className="rail-favorites-title">常用笔记本</div>
      {pinnedNotebooks.length ? (
        pinnedNotebooks.map((notebook) => (
          <div key={notebook.id} className="rail-fav-item">
            <Link to={`/collections/${notebook.id}`} className="rail-row is-fav">
              <StickyNote aria-hidden="true" size={15} />
              <span className="truncate">{notebook.title}</span>
            </Link>
            <button type="button" className="rail-pin is-on" aria-label={`取消置顶 ${notebook.title}`} onClick={() => togglePin(notebook.id)}>
              <Pin aria-hidden="true" size={13} />
            </button>
          </div>
        ))
      ) : (
        <div className="rail-favorites-empty">暂无常用笔记本</div>
      )}
    </div>
  );
}

/**
 * Business rail: one fixed-width column of icon + label tiles. It does not
 * expand — deeper navigation belongs to the section menu column beside it.
 */
export function BusinessRail() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const clearSession = useStore(authStore, (state) => state.clearSession);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  const areas = [
    { label: "首页", to: "/home", icon: Home, match: (p: string) => p === "/home" },
    { label: "在线文档", to: "/documents", icon: BookOpen, match: (p: string) => p.startsWith("/documents") || p.startsWith("/collections") },
    { label: "知识库", to: "/knowledge", icon: LibraryBig, match: (p: string) => p.startsWith("/knowledge") },
    { label: "记忆", to: "/memory", icon: Sparkles, match: (p: string) => p.startsWith("/memory") },
  ];

  return (
    <aside className="workspace-business-rail">
      <div className="rail-inner">
        <div className="rail-header">
          <WorkspaceSwitcher />
        </div>

        <nav className="workspace-business-nav" aria-label="业务板块">
          {accessToken ? <RailCreateMenu /> : null}

          <Link to="/documents/search" className={`rail-tile${pathname === "/documents/search" ? " is-active" : ""}`}>
            <span className="rail-tile-icon">
              <Search aria-hidden="true" size={24} strokeWidth={2.15} />
            </span>
            <span className="rail-tile-label">搜索</span>
          </Link>

          {areas.map(({ label, to, icon: Icon, match }) => (
            <Link key={label} to={to} className={`rail-tile${match(pathname) ? " is-active" : ""}`}>
              <span className="rail-tile-icon">
                <Icon aria-hidden="true" size={24} strokeWidth={2.15} />
              </span>
              <span className="rail-tile-label">{label}</span>
            </Link>
          ))}

          {accessToken ? (
            <div className="rail-fav-trigger-group">
              <button type="button" className="rail-tile" aria-label="常用笔记本">
                <span className="rail-tile-icon">
                  <StickyNote aria-hidden="true" size={24} strokeWidth={2.15} />
                </span>
                <span className="rail-tile-label">常用</span>
              </button>
              <PinnedList />
            </div>
          ) : null}
        </nav>

        {/* Avatar opens the full menu; the gear is a direct shortcut. Logout
            stays menu-only on purpose: a one-click destructive action on the
            rail is easy to hit by accident, and duplicating the label would
            leave two identically named controls. */}
        <div className="rail-bottom">
          <Link to="/settings/account" className="rail-foot-action" aria-label="账号设置">
            <Settings aria-hidden="true" size={19} strokeWidth={2} />
          </Link>
          <UserMenu user={user} workspace={workspace} onLogout={logout} />
        </div>
      </div>
    </aside>
  );
}
