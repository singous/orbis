import { BookOpen, Home, LibraryBig, PanelLeftClose, PanelLeftOpen, Pin, Search, Sparkles, StickyNote } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { useNotebooks } from "../documents/queries";
import { usePinnedNotebooks } from "../documents/pinned-notebooks";
import { authStore } from "../../shared/auth/auth-store";
import { Tooltip } from "../../shared/ui/Tooltip";

const RAIL_EXPANDED_KEY = "orbis.railExpanded";

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
          <div className="rail-favorites-empty">在笔记本卡片上点置顶可添加到常用</div>
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

export function BusinessRail() {
  const { pathname } = useLocation();
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const [expanded, setExpanded] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(RAIL_EXPANDED_KEY) === "1",
  );

  useEffect(() => {
    window.localStorage.setItem(RAIL_EXPANDED_KEY, expanded ? "1" : "0");
  }, [expanded]);

  const areas = [
    { label: "首页", to: "/home", icon: Home, match: (p: string) => p === "/home" },
    { label: "在线文档", to: "/documents", icon: BookOpen, match: (p: string) => p.startsWith("/documents") || p.startsWith("/collections") },
    { label: "知识库", to: "/knowledge", icon: LibraryBig, match: (p: string) => p.startsWith("/knowledge") },
    { label: "记忆", to: "/memory", icon: Sparkles, match: (p: string) => p.startsWith("/memory") },
  ];

  return (
    <aside className={`workspace-business-rail${expanded ? " is-expanded" : ""}`}>
      <div className="flex w-full items-center justify-center gap-2">
        <Link to="/documents" aria-label="Orbis 在线文档" className="workspace-brand">
          O
        </Link>
        {expanded ? (
          <button type="button" className="rail-expand" aria-label="收起侧栏" onClick={() => setExpanded(false)}>
            <PanelLeftClose aria-hidden="true" size={15} />
          </button>
        ) : null}
      </div>

      <nav className="workspace-business-nav" aria-label="业务板块">
        {areas.map(({ label, to, icon: Icon, match }) =>
          expanded ? (
            <Link key={label} to={to} className={`rail-row${match(pathname) ? " is-active" : ""}`}>
              <Icon aria-hidden="true" size={17} />
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

        {expanded ? (
          <Link to="/documents/search" className={`rail-row${pathname === "/documents/search" ? " is-active" : ""}`}>
            <Search aria-hidden="true" size={17} />
            <span>搜索</span>
          </Link>
        ) : (
          <Tooltip label="搜索" side="right">
            <Link to="/documents/search" aria-label="搜索" className={`rail-icon${pathname === "/documents/search" ? " is-active" : ""}`}>
              <Search aria-hidden="true" size={18} />
            </Link>
          </Tooltip>
        )}
      </nav>

      <div className="rail-bottom">
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

        {!expanded ? (
          <Tooltip label="展开侧栏" side="right">
            <button type="button" className="rail-icon" aria-label="展开侧栏" onClick={() => setExpanded(true)}>
              <PanelLeftOpen aria-hidden="true" size={18} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </aside>
  );
}
