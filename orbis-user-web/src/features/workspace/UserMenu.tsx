import { UserAvatar } from "../../shared/ui/UserAvatar";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { LogOut, Monitor, Moon, Settings, Sun, Users } from "../../shared/ui/icons";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import type { User, Workspace } from "../../shared/api/schemas";
import { ActionButton } from "../../shared/ui/ActionButton";
import { useCompactNavigation } from "../../shared/platform/use-compact-navigation";
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
  const compact = useCompactNavigation();
  const ThemeIcon = mode === "system" ? Monitor : mode === "dark" ? Moon : Sun;

  return (
    <div className={`workspace-user-menu${variant === "rail" ? " workspace-user-menu--rail" : ""}`}>
      <Dropdown>
        <ActionButton type="button" className={`workspace-user-trigger${variant === "rail" ? " workspace-user-trigger--rail" : ""}`} aria-label="打开用户菜单">
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
          }}>
            {canManageWorkspaceMembers(workspace) ? (
              <Dropdown.Item id="members" href="/settings/members" textValue="工作空间成员" className="workspace-user-menu-item" render={(props) => "href" in props ? <Link {...props} to="/settings/members" /> : <div {...props} />}>
                <Users aria-hidden="true" size={14} /><Label>工作空间成员</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="account" href="/settings/account" textValue="账号" className="workspace-user-menu-item" render={(props) => "href" in props ? <Link {...props} to="/settings/account" /> : <div {...props} />}>
              <Settings aria-hidden="true" size={14} /><Label>账号</Label>
            </Dropdown.Item>
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="appearance" textValue="外观" className="workspace-user-menu-item">
                <ThemeIcon aria-hidden="true" size={14} /><Label>外观</Label><Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover className="workspace-appearance-popover" placement={compact ? "bottom" : "right top"} shouldFlip>
                <Dropdown.Menu aria-label="外观模式" selectionMode="single" disallowEmptySelection selectedKeys={[mode]} onAction={key => {
                  if (isAppearanceMode(key)) setAppearanceMode(key);
                }}>
                  <Dropdown.Item id="light" textValue="白天" className="workspace-user-menu-item"><Dropdown.ItemIndicator /><Sun aria-hidden="true" size={14} /><Label>白天</Label></Dropdown.Item>
                  <Dropdown.Item id="dark" textValue="夜间" className="workspace-user-menu-item"><Dropdown.ItemIndicator /><Moon aria-hidden="true" size={14} /><Label>夜间</Label></Dropdown.Item>
                  <Dropdown.Item id="system" textValue="跟随系统" className="workspace-user-menu-item"><Dropdown.ItemIndicator /><Monitor aria-hidden="true" size={14} /><Label>跟随系统</Label></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
            <Dropdown.Item id="logout" textValue="退出登录" className="workspace-user-menu-item">
              <LogOut aria-hidden="true" size={14} /><Label>退出登录</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
