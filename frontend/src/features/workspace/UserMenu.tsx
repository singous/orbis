import { cn } from "@orbis/ui/cn";
import { railControlClassName } from "./workspace-chrome";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel } from "@orbis/ui/dropdown-menu";
import { BookOpen, ChevronRight, LogOut, Monitor, Moon, Settings, Sun, Users } from "../../shared/ui/icons";
import { Link } from "react-router-dom";
import { useStore } from "zustand";
import { useRef, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";
import { Dialog, DialogContent } from "@orbis/ui/dialog";

import type { User, Workspace } from "../../shared/api/schemas";
import { appearanceStore, setAppearanceMode } from "../../shared/theme/appearance";
import { canManageWorkspaceMembers, workspaceRoleLabel } from "./capabilities";

const userMenuItemClassName = "workspace-user-menu-item flex min-h-(--ob-control-height-md) w-full items-center gap-2.5 px-3 py-2 text-left text-sm [&_svg]:size-[1.125rem]";

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
    <div className={cn("workspace-user-menu relative ml-auto", variant === "rail" && "workspace-user-menu--rail m-0")}>
      <DropdownMenu>
        <DropdownMenuTrigger ref={triggerRef} type="button" className={cn("workspace-user-trigger grid min-h-(--ob-control-height-sm) min-w-(--ob-control-height-sm) place-items-center", variant === "rail" && [railControlClassName, "workspace-user-trigger--rail"])} aria-label="打开用户菜单">
          <UserAvatar user={user} className="workspace-user-avatar size-[30px]" />
          {variant === "topbar" ? <span className="workspace-user-trigger-copy hidden">
            <span className="truncate">{userName}</span>
            <span className="workspace-user-trigger-role">{workspaceRoleLabel(workspace?.role)}</span>
          </span> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="用户操作" finalFocus={!appearanceOpen} className={cn("workspace-user-popover w-[268px] p-2", variant === "rail" && "workspace-user-popover--rail w-[min(268px,calc(100vw-80px))] max-w-[calc(100vw-24px)]")} side={variant === "rail" ? "right" : "bottom"} align="end" sideOffset={12}>
          <div className="workspace-user-profile mb-2 flex items-center gap-3 rounded-ob-lg bg-(--ob-item-hover-bg) p-3">
            <UserAvatar user={user} className="workspace-user-avatar size-9 flex-none" />
            <div className={variant === "rail" ? "min-w-0 wrap-anywhere" : undefined}>
              <div className="workspace-user-name text-sm font-medium">{userName}</div>
              <div className="workspace-user-space mt-0.5 text-ob-caption text-ob-muted-foreground">{user?.email}</div>
            </div>
          </div>
          <DropdownMenuGroup className="p-1">
            <DropdownMenuLabel className="workspace-user-actions-label px-2.5 pt-[3px] pb-1.5 text-ob-caption text-ob-muted-foreground">设置</DropdownMenuLabel>
            {canManageWorkspaceMembers(workspace) ? (
              <DropdownMenuItem asChild textValue="工作空间成员" className={userMenuItemClassName}><Link to="/settings/members"><Users aria-hidden="true" size={14} /><span>工作空间成员</span></Link></DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild textValue="账号" className={userMenuItemClassName}><Link to="/settings/account"><Settings aria-hidden="true" size={14} /><span>账号</span></Link></DropdownMenuItem>
            <DropdownMenuItem textValue="外观" className={userMenuItemClassName} onSelect={() => setAppearanceOpen(true)}><ThemeIcon aria-hidden="true" size={14} /><span>外观</span><ChevronRight aria-hidden="true" size={14} className="ms-auto" /></DropdownMenuItem>
            <DropdownMenuItem asChild textValue="开源许可" className={userMenuItemClassName}><a href="/licenses/"><BookOpen aria-hidden="true" size={14} /><span>开源许可</span></a></DropdownMenuItem>
            <DropdownMenuItem textValue="退出登录" className={userMenuItemClassName} onSelect={onLogout}><LogOut aria-hidden="true" size={14} /><span>退出登录</span></DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <DialogContent title="外观" className="workspace-appearance-dialog w-[min(320px,calc(100vw-32px))]" finalFocus={triggerRef}>
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
