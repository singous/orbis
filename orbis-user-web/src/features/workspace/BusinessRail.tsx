import { BookOpen, Globe, Home, LibraryBig, Search, Settings, Sparkles } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { RailCreateMenu } from "./RailCreateMenu";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

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
    { label: "站点", to: "/sites", icon: Globe, match: (p: string) => p.startsWith("/sites") },
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
              <Search aria-hidden="true" size={24} strokeWidth={2} />
            </span>
            <span className="rail-tile-label">搜索</span>
          </Link>

          {areas.map(({ label, to, icon: Icon, match }) => (
            <Link key={label} to={to} className={`rail-tile${match(pathname) ? " is-active" : ""}`}>
              <span className="rail-tile-icon">
                <Icon aria-hidden="true" size={24} strokeWidth={2} />
              </span>
              <span className="rail-tile-label">{label}</span>
            </Link>
          ))}
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
