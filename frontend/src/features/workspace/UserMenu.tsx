import { UserAvatar } from "../../shared/ui/UserAvatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel } from "@orbis/ui/dropdown-menu";
import { ChevronRight, LogOut, Monitor, Moon, Settings, Sun, Users } from "../../shared/ui/icons";
import { Link } from "react-router-dom";
import { useStore } from "zustand";
import { useRef, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";
import { Dialog, DialogContent } from "@orbis/ui/dialog";

import type { User, Workspace } from "../../shared/api/schemas";
import { appearanceStore, setAppearanceMode } from "../../shared/theme/appearance";
import { canManageWorkspaceMembers, workspaceRoleLabel } from "./capabilities";

export type UserMenuProps = {
  user: User | null;
  workspace: Workspace | null;
  onLogout: () => void;
  variant?: "topbar" | "rail";
};

export function UserMenu({ user, workspace, onLogout, variant = "topbar" }: UserMenuProps) {
  const userName = user?.display_name || user?.email || "Orbis";
  const mode = useStore(appearanceStore, state => state.mode);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ThemeIcon = mode === "system" ? Monitor : mode === "dark" ? Moon : Sun;

  return (
    <div className={`workspace-user-menu${variant === "rail" ? " workspace-user-menu--rail" : ""}`}>
      <DropdownMenu>
        <DropdownMenuTrigger ref={triggerRef} type="button" className={`workspace-user-trigger${variant === "rail" ? " workspace-user-trigger--rail" : ""}`} aria-label="打开用户菜单">
          <UserAvatar user={user} className="workspace-user-avatar" />
          {variant === "topbar" ? <span className="workspace-user-trigger-copy">
            <span className="truncate">{userName}</span>
            <span className="workspace-user-trigger-role">{workspaceRoleLabel(workspace?.role)}</span>
          </span> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="用户操作" finalFocus={!appearanceOpen} className={`workspace-user-popover${variant === "rail" ? " workspace-user-popover--rail" : ""}`} side={variant === "rail" ? "right" : "bottom"} align="end" sideOffset={12}>
          <div className="workspace-user-profile">
            <UserAvatar user={user} className="workspace-user-avatar" />
            <div>
              <div className="workspace-user-name">{userName}</div>
              <div className="workspace-user-space">{user?.email}</div>
            </div>
          </div>
          <DropdownMenuGroup className="p-1">
            <DropdownMenuLabel className="workspace-user-actions-label">设置</DropdownMenuLabel>
            {canManageWorkspaceMembers(workspace) ? (
              <DropdownMenuItem asChild textValue="工作空间成员" className="workspace-user-menu-item"><Link to="/settings/members"><Users aria-hidden="true" size={14} /><span>工作空间成员</span></Link></DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild textValue="账号" className="workspace-user-menu-item"><Link to="/settings/account"><Settings aria-hidden="true" size={14} /><span>账号</span></Link></DropdownMenuItem>
            <DropdownMenuItem textValue="外观" className="workspace-user-menu-item" onSelect={() => setAppearanceOpen(true)}><ThemeIcon aria-hidden="true" size={14} /><span>外观</span><ChevronRight aria-hidden="true" size={14} className="ms-auto" /></DropdownMenuItem>
            <DropdownMenuItem textValue="退出登录" className="workspace-user-menu-item" onSelect={onLogout}><LogOut aria-hidden="true" size={14} /><span>退出登录</span></DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <DialogContent title="外观" className="workspace-appearance-dialog" finalFocus={triggerRef}>
          <RadioGroup aria-label="外观模式" value={mode} onValueChange={setAppearanceMode}>
            <RadioGroupItem value="light"><Sun aria-hidden="true" size={18} /><span>白天</span></RadioGroupItem>
            <RadioGroupItem value="dark"><Moon aria-hidden="true" size={18} /><span>夜间</span></RadioGroupItem>
            <RadioGroupItem value="system"><Monitor aria-hidden="true" size={18} /><span>跟随系统</span></RadioGroupItem>
          </RadioGroup>
        </DialogContent>
      </Dialog>
    </div>
  );
}
