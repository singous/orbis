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
        <DropdownMenuContent size="sm" aria-label="用户操作" finalFocus={!appearanceOpen} className="workspace-user-popover workspace-user-popover--rail w-64" side="right" align="end" sideOffset={8}>
          <div className="workspace-user-profile mb-1 flex items-center gap-2.5 rounded-lg bg-sidebar px-3 py-2">
            <div className="min-w-0 flex-1 wrap-anywhere">
              <div className="workspace-user-name text-xs font-semibold">{userName}</div>
              <div className="workspace-user-space mt-0.5 text-[11px] text-muted-foreground">{user?.email}</div>
            </div>
            <UserAvatar user={user} size="default" className="workspace-user-avatar size-8 flex-none" />
          </div>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="workspace-user-actions-label sr-only">设置</DropdownMenuLabel>
            <DropdownMenuItem icon={<Settings />} label="账号" render={<Link to="/settings/account" />}>账号</DropdownMenuItem>
            {canManageWorkspaceMembers(workspace) ? (
              <DropdownMenuItem icon={<Users />} label="工作空间成员" render={<Link to="/settings/members" />}>工作空间成员</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem icon={<ThemeIcon />} label="外观" onClick={() => setAppearanceOpen(true)}><span className="flex items-center gap-2">外观<ChevronRight aria-hidden="true" className="ms-auto text-muted-foreground" /></span></DropdownMenuItem>
            <DropdownMenuItem icon={<BookOpen />} label="开源许可" render={<a href="/licenses/" />}>开源许可</DropdownMenuItem>
            <DropdownMenuItem icon={<LogOut />} label="退出登录" onClick={onLogout}>退出登录</DropdownMenuItem>
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
