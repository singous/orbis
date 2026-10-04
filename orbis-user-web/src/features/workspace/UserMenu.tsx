import { UserAvatar } from "../../shared/ui/UserAvatar";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { LogOut, Monitor, Moon, Settings, Sun, Users } from "../../shared/ui/icons";
import { Link } from "react-router-dom";
import { useStore } from "zustand";
import { useRef, useState } from "react";
import { Radio } from "@heroui/react/radio";
import { RadioGroup } from "@heroui/react/radio-group";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";

import type { User, Workspace } from "../../shared/api/schemas";
import { ActionButton } from "../../shared/ui/ActionButton";
import { appearanceStore, isAppearanceMode, setAppearanceMode } from "../../shared/theme/appearance";
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
  function closeAppearance() {
    setAppearanceOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected || active.closest(".workspace-appearance-dialog")) triggerRef.current?.focus();
    }));
  }
  const ThemeIcon = mode === "system" ? Monitor : mode === "dark" ? Moon : Sun;

  return (
    <div className={`workspace-user-menu${variant === "rail" ? " workspace-user-menu--rail" : ""}`}>
      <Dropdown>
        <ActionButton ref={triggerRef} type="button" className={`workspace-user-trigger${variant === "rail" ? " workspace-user-trigger--rail" : ""}`} aria-label="打开用户菜单">
          <UserAvatar user={user} className="workspace-user-avatar" />
          {variant === "topbar" ? <span className="workspace-user-trigger-copy">
            <span className="truncate">{userName}</span>
            <span className="workspace-user-trigger-role">{workspaceRoleLabel(workspace?.role)}</span>
          </span> : null}
        </ActionButton>
        <Dropdown.Popover className={`workspace-user-popover${variant === "rail" ? " workspace-user-popover--rail" : ""}`} placement={variant === "rail" ? "right bottom" : "bottom end"} shouldFlip offset={12}>
          <div className="workspace-user-profile">
            <UserAvatar user={user} className="workspace-user-avatar" />
            <div>
              <div className="workspace-user-name">{userName}</div>
              <div className="workspace-user-space">{user?.email}</div>
            </div>
          </div>
          <div className="workspace-user-actions-label">设置</div>
          <Dropdown.Menu aria-label="用户操作" className="p-1" onAction={(key) => {
            if (key === "logout") onLogout();
            if (key === "appearance") setAppearanceOpen(true);
          }}>
            {canManageWorkspaceMembers(workspace) ? (
              <Dropdown.Item id="members" href="/settings/members" textValue="工作空间成员" className="workspace-user-menu-item" render={(props) => "href" in props ? <Link {...props} to="/settings/members" /> : <div {...props} />}>
                <Users aria-hidden="true" size={14} /><Label>工作空间成员</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="account" href="/settings/account" textValue="账号" className="workspace-user-menu-item" render={(props) => "href" in props ? <Link {...props} to="/settings/account" /> : <div {...props} />}>
              <Settings aria-hidden="true" size={14} /><Label>账号</Label>
            </Dropdown.Item>
            <Dropdown.Item id="appearance" textValue="外观" className="workspace-user-menu-item">
              <ThemeIcon aria-hidden="true" size={14} /><Label>外观</Label><Dropdown.SubmenuIndicator />
            </Dropdown.Item>
            <Dropdown.Item id="logout" textValue="退出登录" className="workspace-user-menu-item">
              <LogOut aria-hidden="true" size={14} /><Label>退出登录</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <Dialog open={appearanceOpen} onOpenChange={open => { if (open) setAppearanceOpen(true); else closeAppearance(); }}>
        <DialogContent title="外观" className="workspace-appearance-dialog">
          <RadioGroup aria-label="外观模式" value={mode} onChange={value => {
            if (isAppearanceMode(value)) setAppearanceMode(value);
          }}>
            <Radio value="light"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><Sun aria-hidden="true" size={18} /><span>白天</span></Radio.Content></Radio>
            <Radio value="dark"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><Moon aria-hidden="true" size={18} /><span>夜间</span></Radio.Content></Radio>
            <Radio value="system"><Radio.Content><Radio.Control><Radio.Indicator /></Radio.Control><Monitor aria-hidden="true" size={18} /><span>跟随系统</span></Radio.Content></Radio>
          </RadioGroup>
        </DialogContent>
      </Dialog>
    </div>
  );
}
