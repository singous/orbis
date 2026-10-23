import { useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  History,
  Layers,
  LayoutTemplate,
  MoreHorizontal,
  PanelLeftClose,
  Shapes,
} from "lucide-react";
import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import type { Board } from "./model";

type Props = {
  board: Board;
  children: ReactNode;
  actions: ReactNode;
  status: ReactNode;
  activeLibrary: string | null;
  onLibrary: (tab: "shapes" | "templates" | "layers") => void;
  onEdit: () => void;
  onHistory: () => void;
};
export function BoardShell({
  board,
  children,
  actions,
  status,
  activeLibrary,
  onLibrary,
  onEdit,
  onHistory,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [help, setHelp] = useState(false);
  const user = useStore(authStore, (state) => state.user);
  const name = user?.display_name || user?.email?.split("@")[0] || "我的账户";
  return (
    <main
      className={"board-shell" + (collapsed ? " is-sidebar-collapsed" : "")}
    >
      <a className="board-skip" href="#board-main">
        跳转到画板
      </a>
      <aside className="board-sidebar" aria-label="画板导航">
        <header className="board-sidebar-header">
          <Link
            to={"/collections/" + board.collection_id}
            aria-label="返回文集"
          >
            <ArrowLeft size={14} />
            <BookOpen size={14} />
            <span>工作空间</span>
          </Link>
          <ActionButton
            aria-label={collapsed ? "展开画板导航" : "收起画板导航"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
          </ActionButton>
        </header>
        <div className="board-resource-card">
          <span className="board-resource-icon">
            <Shapes size={22} />
          </span>
          <div>
            <strong title={board.title}>{board.title}</strong>
            <small>画板</small>
          </div>
          <Link
            className="board-resource-more"
            to={"/collections/" + board.collection_id}
            title="在文集中管理"
            aria-label="在文集中管理画板"
          >
            <MoreHorizontal size={17} />
          </Link>
        </div>
        <nav className="board-sidebar-nav">
          <button
            className={!activeLibrary ? "is-active" : ""}
            title="编辑画板"
            onClick={onEdit}
          >
            <Shapes size={16} />
            <span>编辑</span>
          </button>
          <button
            className={activeLibrary === "layers" ? "is-active" : ""}
            title="页面与图层"
            onClick={() => onLibrary("layers")}
          >
            <Layers size={16} />
            <span>页面与图层</span>
          </button>
          <button
            className={activeLibrary === "templates" ? "is-active" : ""}
            title="模板库"
            onClick={() => onLibrary("templates")}
          >
            <LayoutTemplate size={16} />
            <span>模板库</span>
          </button>
          <button title="历史版本" onClick={onHistory}>
            <History size={16} />
            <span>历史版本</span>
          </button>
        </nav>
        <div className="board-sidebar-bottom">
          <Link to="/settings/account" className="board-account">
            <span className="board-avatar">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span>{name}</span>
          </Link>
          <ActionButton
            title="快捷键帮助"
            aria-label="画板快捷键帮助"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={16} />
          </ActionButton>
        </div>
      </aside>
      <section className="board-shell-main" id="board-main">
        <header className="board-topbar">
          <div className="board-topbar-status">
            {status}
            <span className="board-status-divider">·</span>
            <time>
              {new Date(board.updated_at_ms).toLocaleTimeString("zh-CN", {
                hour12: false,
                timeZone: "Asia/Shanghai",
              })}
            </time>
          </div>
          <div className="board-topbar-actions">
            <span className="board-avatar" title={name}>
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="board-topbar-divider" />
            {actions}
          </div>
        </header>
        {children}
      </section>
      {help ? (
        <Dialog open onOpenChange={setHelp}>
          <DialogContent title="画板快捷键">
            <dl className="board-shortcuts">
              <dt>空格 + 拖动</dt>
              <dd>平移画布</dd>
              <dt>Ctrl / ⌘ + 滚轮</dt>
              <dd>缩放画布</dd>
              <dt>Ctrl / ⌘ + Z</dt>
              <dd>撤销</dd>
              <dt>Ctrl / ⌘ + Shift + Z</dt>
              <dd>重做</dd>
              <dt>Ctrl / ⌘ + C / V</dt>
              <dd>复制 / 粘贴对象</dd>
              <dt>方向键</dt>
              <dd>微调位置，Shift 加速</dd>
              <dt>双击对象</dt>
              <dd>编辑文字</dd>
              <dt>Escape</dt>
              <dd>结束工具并取消选择</dd>
            </dl>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}
