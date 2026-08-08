import { ChevronUp, LogOut, Settings, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { User, Workspace } from "../../shared/api/schemas";

export type UserMenuProps = {
  user: User | null;
  workspace: Workspace | null;
  onLogout: () => void;
};

function canManageMembers(workspace: Workspace | null): boolean {
  return workspace?.role === "owner" || workspace?.role === "admin";
}

export function UserMenu({ user, workspace, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const userName = user?.display_name || user?.email || "Orbis";

  return (
    <div className="workspace-user-menu">
      {open ? (
        <div className="workspace-user-popover" role="menu" aria-label="用户菜单">
          <div className="border-b border-[var(--border)] px-3 py-2.5">
            <div className="truncate text-xs font-semibold">{userName}</div>
            <div className="mt-0.5 truncate text-[10px] text-[var(--muted-light)]">{workspace?.name ?? "私人工作空间"}</div>
          </div>
          <div className="p-1">
            {canManageMembers(workspace) ? <Link to="/settings/members" role="menuitem" className="workspace-user-menu-item" onClick={() => setOpen(false)}><Users aria-hidden="true" size={14} />工作空间成员</Link> : null}
            <Link to="/settings/account" role="menuitem" className="workspace-user-menu-item" onClick={() => setOpen(false)}><Settings aria-hidden="true" size={14} />账号</Link>
            <button type="button" role="menuitem" className="workspace-user-menu-item" onClick={onLogout}><LogOut aria-hidden="true" size={14} />退出登录</button>
          </div>
        </div>
      ) : null}
      <button type="button" className="workspace-user-trigger" aria-label="打开用户菜单" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="workspace-user-avatar">{userName.slice(0, 1).toUpperCase()}</span>
        <span className="workspace-user-trigger-copy"><span className="truncate">{userName}</span><span className="capitalize text-[10px] text-white/45">{workspace?.role ?? "member"}</span></span>
        <ChevronUp aria-hidden="true" size={14} className={open ? "rotate-180" : ""} />
      </button>
    </div>
  );
}
