import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { BookOpen, Clock3, Search, Archive } from "../../shared/ui/icons";
import { NotebookIcon } from "../documents/NotebookIcon";
import { useNotebooks } from "../documents/queries";
import { usePinnedNotebooks } from "../documents/pinned-notebooks";

/** Keep the application rail visible while notebook shortcuts open beside it. */
export function NotebookQuickAccess({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const { pathname } = useLocation();
  const accessToken = useStore(authStore, (state) => state.accessToken);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="rail-document-entry" onKeyDown={(event) => {
    if (!open || event.key !== "Escape" || event.defaultPrevented) return;
    // Consume the nested popover's Escape before the drawer's document listener.
    event.preventDefault();
    setOpen(false);
    trigger.current?.focus();
  }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <Link ref={trigger} to="/documents" aria-label="在线文档" aria-current={active ? "page" : undefined} aria-expanded={open} aria-controls="notebook-quick-access" className={`rail-action${active ? " is-active" : ""}`} onClick={() => setOpen(true)} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); setOpen(true); window.setTimeout(() => root.current?.querySelector<HTMLAnchorElement>(".rail-notebook-popover a")?.focus(), 0); } }}><BookOpen aria-hidden="true" size={22} /></Link>
    {open && accessToken ? <nav id="notebook-quick-access" className="rail-notebook-popover" aria-label="笔记本快捷访问">
      <Link to="/documents" className="rail-notebook-popover-title" onClick={() => setOpen(false)}>在线文档<span aria-hidden="true">›</span></Link>
      <NotebookShortcutLinks onNavigate={() => setOpen(false)} />
      <div className="rail-notebook-tools">
        <Link to="/documents/recent" onClick={() => setOpen(false)}><Clock3 size={15} />最近编辑</Link>
        <Link to="/documents/search" onClick={() => setOpen(false)}><Search size={15} />全文搜索</Link>
        <Link to="/documents/archive" onClick={() => setOpen(false)}><Archive size={15} />归档</Link>
      </div>
    </nav> : null}
  </div>;
}


function NotebookShortcutLinks({ onNavigate }: { onNavigate: () => void }) {
  const workspace = useStore(authStore, (state) => state.workspace);
  const notebooks = useNotebooks();
  const { isPinned } = usePinnedNotebooks(workspace?.id);
  const shortcuts = (notebooks.data?.items ?? []).filter((notebook) => isPinned(notebook.id));
  return <div className="rail-notebook-shortcuts">
    <span className="workspace-nav-label">快捷访问</span>
    {shortcuts.map((notebook) => <Link key={notebook.id} to={`/collections/${notebook.id}`} onClick={onNavigate}><NotebookIcon icon={notebook.icon} size="sm" /><span>{notebook.title}</span></Link>)}
    {notebooks.isLoading ? <p role="status">正在加载快捷访问…</p> : notebooks.isError ? <p role="alert">未能加载笔记本，请稍后重试。</p> : !shortcuts.length ? <p>在笔记本上选择“加入快捷访问”，即可显示在这里。</p> : null}
  </div>;
}
