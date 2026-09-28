import { Avatar } from "@heroui/react/avatar";
import { Popover } from "@heroui/react/popover";
import { Boxes, Check, ChevronDown } from "../../shared/ui/icons";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";

/** Space details remain informational until tenant switching is available. */
export function WorkspaceSwitcher() {
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const userName = user?.display_name || user?.email || "Orbis";
  const currentIsPrivate = workspace?.workspace_type === "private";

  return (
    <div className="workspace-switcher">
      <Popover>
        <ActionButton type="button" className="workspace-brand" aria-label="切换工作空间">
          <span className="workspace-brand-mark"><Boxes size={16} aria-hidden="true" /></span>
          <span className="workspace-brand-word">{workspace?.name ?? "Orbis"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </ActionButton>
        <Popover.Content className="workspace-switcher-popover" placement="bottom start" offset={12}>
          <Popover.Dialog className="workspace-switcher-dialog" aria-label="工作空间详情">
            <div className="workspace-switcher-group">个人</div>
            <div className="workspace-switcher-item">
              <Avatar size="sm" className="workspace-switcher-avatar"><Avatar.Fallback>{userName.slice(0, 1).toUpperCase()}</Avatar.Fallback></Avatar>
              <span className="min-w-0 flex-1">
                <span className="workspace-switcher-name truncate">{userName}</span>
                <span className="workspace-switcher-sub">我自己</span>
              </span>
              {currentIsPrivate ? <Check aria-hidden="true" size={16} className="workspace-switcher-check" /> : null}
            </div>
            <div className="workspace-switcher-group">空间</div>
            {workspace && !currentIsPrivate ? (
              <div className="workspace-switcher-item">
                <span className="workspace-switcher-space-icon"><Boxes aria-hidden="true" size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="workspace-switcher-name truncate">{workspace.name}</span>
                  <span className="workspace-switcher-sub">团队空间</span>
                </span>
                <Check aria-hidden="true" size={16} className="workspace-switcher-check" />
              </div>
            ) : <div className="workspace-switcher-empty">暂无团队空间</div>}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
