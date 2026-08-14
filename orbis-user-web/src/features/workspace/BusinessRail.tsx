import { BookOpen, Home, LibraryBig, PanelLeftClose, PanelLeftOpen, Pin, Search, Sparkles, StickyNote } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { useNotebooks } from "../documents/queries";
import { usePinnedNotebooks } from "../documents/pinned-notebooks";
import { authStore } from "../../shared/auth/auth-store";
import { Tooltip } from "../../shared/ui/Tooltip";
import { RailCreateMenu } from "./RailCreateMenu";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function PinnedList({ expanded }: { expanded: boolean }) {
  const workspaceId = useStore(authStore, (state) => state.workspace?.id);
  const notebooksQuery = useNotebooks();
  const { pinned, togglePin } = usePinnedNotebooks(workspaceId);
  const notebooks = notebooksQuery.data?.items ?? [];
  const pinnedNotebooks = pinned
    .map((id) => notebooks.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  if (expanded) {
    return (
      <div className="rail-favorites">
        <div className="rail-favorites-title">常用笔记本</div>
        {pinnedNotebooks.length ? (
          pinnedNotebooks.map((notebook) => (
            <div key={notebook.id} className="rail-fav-item">
              <Link to={`/collections/${notebook.id}`} className="rail-row is-fav">
                <StickyNote aria-hidden="true" size={16} />
                <span className="truncate">{notebook.title}</span>
              </Link>
              <button type="button" className="rail-pin is-on" aria-label={`取消置顶 ${notebook.title}`} onClick={() => togglePin(notebook.id)}>
                <Pin aria-hidden="true" size={13} />
              </button>
            </div>
          ))
        ) : (
          <div className="rail-favorites-empty">置顶笔记本后会出现在这里</div>
        )}
      </div>
    );
  }

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

export type BusinessRailProps = {
  /** Pinned open in the layout flow. Unpinned: narrow floating rail that
   * expands on hover. */
  pinned: boolean;
  /** Compact viewports use the drawer pattern instead of hover expansion. */
  compact: boolean;
  onTogglePinned: () => void;
};

export function BusinessRail({ pinned, compact, onTogglePinned }: BusinessRailProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const clearSession = useStore(authStore, (state) => state.clearSession);
  const [hovered, setHovered] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const expanded = !compact && (pinned || hovered);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = searchQuery.trim();
    navigate(keyword ? `/documents/search?q=${encodeURIComponent(keyword)}` : "/documents/search");
  }

  const areas = [
    { label: "首页", to: "/home", icon: Home, match: (p: string) => p === "/home" },
    { label: "在线文档", to: "/documents", icon: BookOpen, match: (p: string) => p.startsWith("/documents") || p.startsWith("/collections") },
    { label: "知识库", to: "/knowledge", icon: LibraryBig, match: (p: string) => p.startsWith("/knowledge") },
    { label: "记忆", to: "/memory", icon: Sparkles, match: (p: string) => p.startsWith("/memory") },
  ];

  return (
    <aside
      className={`workspace-business-rail${expanded ? " is-expanded" : ""}${pinned ? " is-pinned" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The aside itself stretches to the full grid-row height so the panel
          never ends mid-page; the inner column sticks to the viewport. */}
      <div className="rail-inner">
      <div className="rail-header">
        <WorkspaceSwitcher expanded={expanded} />
        {expanded ? (
          <Tooltip label={pinned ? "收起侧栏" : "固定侧栏"} side="right">
            <button
              type="button"
              className="rail-pin-toggle"
              aria-label={pinned ? "收起侧栏" : "固定侧栏"}
              aria-pressed={pinned}
              onClick={onTogglePinned}
            >
              {pinned ? <PanelLeftClose aria-hidden="true" size={13} /> : <PanelLeftOpen aria-hidden="true" size={13} />}
            </button>
          </Tooltip>
        ) : null}
      </div>

      <nav className="workspace-business-nav" aria-label="业务板块">
        {expanded ? (
          <div className="rail-search-row">
            <form className="rail-search-field" onSubmit={submitSearch}>
              <Search aria-hidden="true" size={14} />
              <input
                type="search"
                className="rail-search-input"
                aria-label="搜索文档"
                placeholder="搜索文档"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </form>
            {accessToken ? <RailCreateMenu expanded /> : null}
          </div>
        ) : (
          <>
            {accessToken ? <RailCreateMenu expanded={false} /> : null}
            <Tooltip label="搜索" side="right">
              <Link to="/documents/search" aria-label="搜索" className={`rail-icon${pathname === "/documents/search" ? " is-active" : ""}`}>
                <Search aria-hidden="true" size={18} />
              </Link>
            </Tooltip>
          </>
        )}

        {areas.map(({ label, to, icon: Icon, match }) =>
          expanded ? (
            <Link key={label} to={to} className={`rail-row${match(pathname) ? " is-active" : ""}`}>
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </Link>
          ) : (
            <Tooltip key={label} label={label} side="right">
              <Link to={to} aria-label={label} className={`rail-icon${match(pathname) ? " is-active" : ""}`}>
                <Icon aria-hidden="true" size={18} />
              </Link>
            </Tooltip>
          ),
        )}

        {accessToken ? (
          expanded ? (
            <PinnedList expanded />
          ) : (
            <div className="rail-fav-trigger-group">
              <Tooltip label="常用笔记本" side="right">
                <button type="button" className="rail-icon" aria-label="常用笔记本">
                  <StickyNote aria-hidden="true" size={18} />
                </button>
              </Tooltip>
              <PinnedList expanded={false} />
            </div>
          )
        ) : null}
      </nav>

      <div className="rail-bottom">
        <UserMenu user={user} workspace={workspace} onLogout={logout} expanded={expanded} />
      </div>
      </div>
    </aside>
  );
}
