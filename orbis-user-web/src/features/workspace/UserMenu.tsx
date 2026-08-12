import { ChevronUp, LogOut, Moon, Settings, Sun, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { User, Workspace } from "../../shared/api/schemas";
import { useThemeStore } from "../../shared/theme/theme-store";
import { canManageWorkspaceMembers } from "./capabilities";

export type UserMenuProps = {
  user: User | null;
  workspace: Workspace | null;
  onLogout: () => void;
};

export function UserMenu({ user, workspace, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const userName = user?.display_name || user?.email || "Orbis";

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="workspace-user-menu">
      {open ? (
        <div id="workspace-user-actions" className="workspace-user-popover">
          <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
            <div className="truncate text-xs font-semibold text-[var(--text-primary)]">{userName}</div>
            <div className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
              {workspace?.name ?? "私人工作空间"}
            </div>
          </div>
          <div className="p-1">
            {canManageWorkspaceMembers(workspace) ? (
              <Link to="/settings/members" className="workspace-user-menu-item" onClick={() => setOpen(false)}>
                <Users aria-hidden="true" size={14} />
                工作空间成员
              </Link>
            ) : null}
            <Link to="/settings/account" className="workspace-user-menu-item" onClick={() => setOpen(false)}>
              <Settings aria-hidden="true" size={14} />
              账号
            </Link>
            <button type="button" className="workspace-user-menu-item" onClick={toggleTheme}>
              {theme === "light" ? <Moon aria-hidden="true" size={14} /> : <Sun aria-hidden="true" size={14} />}
              {theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
            </button>
            <button type="button" className="workspace-user-menu-item" onClick={onLogout}>
              <LogOut aria-hidden="true" size={14} />
              退出登录
            </button>
          </div>
        </div>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className="workspace-user-trigger"
        aria-label="打开用户菜单"
        aria-controls="workspace-user-actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-user-avatar">{userName.slice(0, 1).toUpperCase()}</span>
        <span className="workspace-user-trigger-copy">
          <span className="truncate">{userName}</span>
          <span className="capitalize text-[10px] text-white/45">{workspace?.role ?? "member"}</span>
        </span>
        <ChevronUp aria-hidden="true" size={14} className={open ? "rotate-180" : ""} />
      </button>
    </div>
  );
}
