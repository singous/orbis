import { BookOpen, FileText, LogOut, PanelLeftClose, Search, Settings, Sparkles } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import type { NoteTreeItem } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { useDocumentGroups, useNotebooks, useNoteTree } from "./queries";

function TreeLinks({ items, activeNoteId, depth = 0 }: { items: NoteTreeItem[]; activeNoteId?: string; depth?: number }) {
  return (
    <>
      {items.map((item) => (
        <div key={item.id}>
          <NavLink
            to={`/documents/${item.id}`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            className={({ isActive }) => `document-tree-link ${isActive || activeNoteId === item.id ? "is-active" : ""}`}
          >
            <FileText aria-hidden="true" size={14} />
            <span className="truncate">{item.title}</span>
          </NavLink>
          {item.children.length ? <TreeLinks items={item.children} activeNoteId={activeNoteId} depth={depth + 1} /> : null}
        </div>
      ))}
    </>
  );
}

export function DocumentShell({
  children,
  activeNotebookId,
  activeNoteId,
  toolbar,
}: {
  children: ReactNode;
  activeNotebookId?: string;
  activeNoteId?: string;
  toolbar?: ReactNode;
}) {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const clearSession = useStore(authStore, (state) => state.clearSession);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const treeQuery = useNoteTree(activeNotebookId);
  const groups = groupsQuery.data?.items ?? [];
  const notebooks = notebooksQuery.data?.items ?? [];
  const notebooksByGroup = useMemo(() => new Map(groups.map((group) => [group.id, notebooks.filter((item) => item.group_id === group.id)])), [groups, notebooks]);

  function logout() {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <main className="min-h-screen bg-[var(--workspace)] text-[var(--text)]">
      <div className="min-h-screen lg:grid lg:grid-cols-[68px_276px_minmax(0,1fr)]">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[68px] flex-col items-center border-r border-white/8 bg-[#101010] py-4 text-white lg:flex">
          <Link to="/documents" aria-label="Orbis 文档中心" className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white text-sm font-black text-black">O</Link>
          <nav className="mt-8 flex flex-1 flex-col items-center gap-2" aria-label="全局导航">
            <NavLink to="/documents" aria-label="文档" title="文档" className={({ isActive }) => `rail-link ${isActive ? "is-active" : ""}`}><BookOpen aria-hidden="true" size={18} /></NavLink>
            <button type="button" aria-label="全局搜索" title="全局搜索" className="rail-link" onClick={() => navigate("/documents?focus=search")}><Search aria-hidden="true" size={18} /></button>
            {workspace?.role === "owner" || workspace?.role === "admin" ? <NavLink to="/settings/members" aria-label="成员设置" title="成员设置" className={({ isActive }) => `rail-link ${isActive ? "is-active" : ""}`}><Settings aria-hidden="true" size={18} /></NavLink> : null}
          </nav>
          <button type="button" aria-label="退出登录" title="退出登录" className="rail-link" onClick={logout}><LogOut aria-hidden="true" size={18} /></button>
        </aside>

        <aside className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-30 w-[276px] border-r border-[var(--border)] bg-[#f7f7f6] transition-transform lg:static lg:col-start-2 lg:translate-x-0`}>
          <div className="flex h-16 items-center justify-between border-b border-[var(--border)] px-4">
            <Link to="/documents" className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted-light)]">Orbis Cloud</div>
              <div className="truncate text-sm font-semibold">{workspace?.name ?? "私人工作空间"}</div>
            </Link>
            <button type="button" aria-label="收起导航" className="icon-button lg:hidden" onClick={() => setSidebarOpen(false)}><PanelLeftClose aria-hidden="true" size={16} /></button>
          </div>

          <div className="h-[calc(100vh-8rem)] overflow-y-auto px-3 py-4">
            <Link to="/documents" className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/5"><Sparkles aria-hidden="true" size={15} />文档中心</Link>
            {groupsQuery.isLoading || notebooksQuery.isLoading ? <div className="px-3 py-2 text-xs text-[var(--muted)]">正在加载文档树…</div> : null}
            {groups.map((group) => (
              <section key={group.id} className="mb-5">
                <div className="mb-1 flex items-center gap-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-light)]">
                  <span className="truncate">{group.name}</span>{group.is_default ? <span className="rounded bg-black/5 px-1 py-0.5 text-[9px] tracking-normal">默认</span> : null}
                </div>
                {(notebooksByGroup.get(group.id) ?? []).map((notebook) => (
                  <div key={notebook.id}>
                    <NavLink to={`/collections/${notebook.id}`} className={({ isActive }) => `collection-link ${isActive || notebook.id === activeNotebookId ? "is-active" : ""}`}>
                      <BookOpen aria-hidden="true" size={14} /><span className="truncate">{notebook.title}</span>
                    </NavLink>
                    {notebook.id === activeNotebookId && treeQuery.data?.items.length ? <div className="mt-1"><TreeLinks items={treeQuery.data.items} activeNoteId={activeNoteId} /></div> : null}
                  </div>
                ))}
              </section>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex h-16 items-center gap-3 border-t border-[var(--border)] bg-[#f7f7f6] px-4">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">{(user?.display_name || user?.email || "O").slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0"><div className="truncate text-xs font-semibold">{user?.display_name || user?.email}</div><div className="text-[10px] capitalize text-[var(--muted-light)]">{workspace?.role ?? "member"}</div></div>
          </div>
        </aside>

        <section className="min-w-0 lg:col-start-3">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--border)] bg-white/92 px-4 backdrop-blur-xl lg:px-7">
            <button type="button" aria-label="打开导航" className="icon-button lg:hidden" onClick={() => setSidebarOpen(true)}><BookOpen aria-hidden="true" size={17} /></button>
            <div className="min-w-0 flex-1 text-sm text-[var(--muted)]">在线云文档</div>
            {toolbar}
          </header>
          {children}
        </section>
      </div>
      {sidebarOpen ? <button type="button" aria-label="关闭导航遮罩" className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} /> : null}
    </main>
  );
}
