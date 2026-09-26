import { Button as HeroButton } from "@heroui/react/button";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { LogOut, Settings, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { User, Workspace } from "../../shared/api/schemas";
import { canManageWorkspaceMembers, workspaceRoleLabel } from "./capabilities";

export type UserMenuProps = {
  user: User | null;
  workspace: Workspace | null;
  onLogout: () => void;
};

export function UserMenu({ user, workspace, onLogout }: UserMenuProps) {
  const navigate = useNavigate();
  const userName = user?.display_name || user?.email || "Orbis";

  return (
    <div className="workspace-user-menu">
      <Dropdown>
        <HeroButton variant="ghost" className="workspace-user-trigger" aria-label="打开用户菜单">
          <span className="workspace-user-avatar">{userName.slice(0, 1).toUpperCase()}</span>
          <span className="workspace-user-trigger-copy">
            <span className="truncate">{userName}</span>
            <span className="workspace-user-trigger-role">{workspaceRoleLabel(workspace?.role)}</span>
          </span>
        </HeroButton>
        <Dropdown.Popover className="workspace-user-popover" placement="bottom end" offset={12}>
          <div className="workspace-user-profile">
            <span className="workspace-user-avatar">{userName.slice(0, 1).toUpperCase()}</span>
            <div>
              <div className="workspace-user-name">{userName}</div>
              <div className="workspace-user-space">{workspace?.name ?? "私人工作空间"}</div>
            </div>
          </div>
          <div className="workspace-user-actions-label">设置</div>
          <Dropdown.Menu aria-label="用户操作" className="p-1" onAction={(key) => {
            if (key === "members") navigate("/settings/members");
            if (key === "account") navigate("/settings/account");
            if (key === "logout") onLogout();
          }}>
            {canManageWorkspaceMembers(workspace) ? (
              <Dropdown.Item id="members" textValue="工作空间成员" className="workspace-user-menu-item">
                <Users aria-hidden="true" size={14} /><Label>工作空间成员</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="account" textValue="账号" className="workspace-user-menu-item">
              <Settings aria-hidden="true" size={14} /><Label>账号</Label>
            </Dropdown.Item>
            <Dropdown.Item id="logout" textValue="退出登录" className="workspace-user-menu-item">
              <LogOut aria-hidden="true" size={14} /><Label>退出登录</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
