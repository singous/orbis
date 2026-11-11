import { cn } from "@orbis/ui/cn";
import { UserAvatar } from "../../shared/ui/UserAvatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel } from "@orbis/ui/dropdown-menu";
import { BookOpen, ChevronRight, LogOut, Monitor, Moon, Settings, Sun, Users } from "../../shared/ui/icons";
import { Link } from "react-router-dom";
import { Button } from "@orbis/ui/button";
import { useStore } from "zustand";
import { useId, useRef, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@orbis/ui/dialog";

import type { User, Workspace } from "../../shared/api/schemas";
import { appearanceStore, setAppearanceMode } from "../../shared/theme/appearance";
import { canManageWorkspaceMembers } from "./capabilities";
import { workspaceMenuPanelClassName, workspaceMenuRowClassName } from "./workspace-navigation-styles";

const appearanceOptions = [{ value: "light", label: "白天", Icon: Sun }, { value: "dark", label: "夜间", Icon: Moon }, { value: "system", label: "跟随系统", Icon: Monitor }] as const;

export type UserMenuProps = {
  user: User | null;
  workspace: Workspace | null;
  onLogout: () => void;
};

export function UserMenu({ user, workspace, onLogout }: UserMenuProps) {
  const userName = user?.display_name || user?.email || "Orbis";
  const mode = useStore(appearanceStore, state => state.mode);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const appearanceId = useId();
  const ThemeIcon = mode === "system" ? Monitor : mode === "dark" ? Moon : Sun;

  return (
    <div className="workspace-user-menu workspace-user-menu--rail relative">
      <DropdownMenu>
        <DropdownMenuTrigger ref={triggerRef} render={<Button variant="ghost" size="icon-lg" />} className="workspace-user-trigger workspace-user-trigger--rail size-9 p-0" aria-label="打开用户菜单">
          <UserAvatar user={user} size="default" className="workspace-user-avatar size-9" />
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="用户操作" finalFocus={!appearanceOpen} className={cn("workspace-user-popover workspace-user-popover--rail", workspaceMenuPanelClassName)} side="right" align="end" sideOffset={8}>
          <div className="workspace-user-profile mb-1 flex min-h-20 items-center gap-3 rounded-xl bg-sidebar px-3.5 py-3">
            <div className="min-w-0 flex-1 wrap-anywhere">
              <div className="workspace-user-name text-sm font-semibold">{userName}</div>
              <div className="workspace-user-space mt-0.5 text-xs text-muted-foreground">{user?.email}</div>
            </div>
            <UserAvatar user={user} size="default" className="workspace-user-avatar size-[42px] flex-none" />
          </div>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="workspace-user-actions-label sr-only">设置</DropdownMenuLabel>
            <DropdownMenuItem className={workspaceMenuRowClassName} label="账号" render={<Link to="/settings/account" />}><Settings aria-hidden="true" /><span>账号</span></DropdownMenuItem>
            {canManageWorkspaceMembers(workspace) ? (
              <DropdownMenuItem className={workspaceMenuRowClassName} label="工作空间成员" render={<Link to="/settings/members" />}><Users aria-hidden="true" /><span>工作空间成员</span></DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className={workspaceMenuRowClassName} label="外观" onClick={() => setAppearanceOpen(true)}><ThemeIcon aria-hidden="true" /><span>外观</span><ChevronRight aria-hidden="true" className="ms-auto" /></DropdownMenuItem>
            <DropdownMenuItem className={workspaceMenuRowClassName} label="开源许可" render={<a href="/licenses/" />}><BookOpen aria-hidden="true" /><span>开源许可</span></DropdownMenuItem>
            <DropdownMenuItem className={workspaceMenuRowClassName} label="退出登录" onClick={onLogout}><LogOut aria-hidden="true" /><span>退出登录</span></DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={appearanceOpen} onOpenChange={setAppearanceOpen}>
        <DialogContent className="workspace-appearance-dialog" finalFocus={triggerRef}><DialogHeader><DialogTitle>{"外观"}</DialogTitle></DialogHeader>
          <RadioGroup aria-label="外观模式" value={mode} onValueChange={value => { if (value === "light" || value === "dark" || value === "system") setAppearanceMode(value); }}>
            {appearanceOptions.map(({ value, label, Icon }) => <div key={value} className="flex items-center gap-3"><RadioGroupItem id={`${appearanceId}-${value}`} value={value} /><label htmlFor={`${appearanceId}-${value}`} className="flex items-center gap-2 text-sm"><Icon aria-hidden="true" size={18} /><span>{label}</span></label></div>)}
          </RadioGroup>
        </DialogContent>
      </Dialog>
    </div>
  );
}
