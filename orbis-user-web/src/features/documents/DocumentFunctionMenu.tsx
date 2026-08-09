import { Archive, Clock3, FileText, FolderKanban, Search } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

const items = [
  { label: "文档概览", to: "/documents", icon: FileText },
  { label: "最近文档", to: "/documents/recent", icon: Clock3 },
  { label: "我的文集", to: "/documents/collections", icon: FolderKanban },
  { label: "搜索", to: "/documents/search", icon: Search },
  { label: "归档", to: "/documents/archive", icon: Archive },
] as const;

function isCollectionContext(pathname: string): boolean {
  return (
    /^\/collections\/[^/]+$/.test(pathname) ||
    (/^\/documents\/[^/]+$/.test(pathname) &&
      !items.some((item) => item.to === pathname))
  );
}

export function DocumentFunctionMenu() {
  const { pathname } = useLocation();

  return (
    <aside className="workspace-function-menu">
      <div className="workspace-function-heading">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted-light)]">
          Orbis Cloud
        </div>
        <div className="mt-1 text-sm font-semibold">在线文档</div>
      </div>
      <nav className="workspace-function-nav" aria-label="在线文档功能">
        {items.map(({ label, to, icon: Icon }) => {
          const collectionActive =
            label === "我的文集" && isCollectionContext(pathname);
          const staticRouteActive = pathname === to;
          const active = collectionActive || staticRouteActive;

          return (
            <NavLink
              key={label}
              to={to}
              className={() =>
                `workspace-function-link ${active ? "is-active" : ""}`
              }
              aria-current={active ? "page" : undefined}
            >
              <Icon aria-hidden="true" size={16} />
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
