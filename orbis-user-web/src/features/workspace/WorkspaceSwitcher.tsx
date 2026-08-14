import { Boxes, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";

/**
 * Brand-chip popover listing the spaces the account belongs to.
 * Multi-tenant switching is intentionally not built in this version, so
 * rows are static: the private space under 个人, team spaces under 空间
 * when the session knows about them.
 */
export function WorkspaceSwitcher() {
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const userName = user?.display_name || user?.email || "Orbis";
  const currentIsPrivate = workspace?.workspace_type === "private";

  useEffect(() => {
    if (!open) return;

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
    <div ref={rootRef} className="workspace-switcher">
      {open ? (
        <div id="workspace-switcher-popover" className="workspace-switcher-popover">
          <div className="workspace-switcher-group">个人</div>
          <div className="workspace-switcher-item">
            <span className="workspace-switcher-avatar">{userName.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="workspace-switcher-name truncate">{userName}</span>
              <span className="workspace-switcher-sub">我自己</span>
            </span>
            {currentIsPrivate ? <Check aria-hidden="true" size={15} className="workspace-switcher-check" /> : null}
          </div>
          <div className="workspace-switcher-group">空间</div>
          {workspace && !currentIsPrivate ? (
            <div className="workspace-switcher-item">
              <span className="workspace-switcher-space-icon"><Boxes aria-hidden="true" size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="workspace-switcher-name truncate">{workspace.name}</span>
                <span className="workspace-switcher-sub">团队空间</span>
              </span>
              <Check aria-hidden="true" size={15} className="workspace-switcher-check" />
            </div>
          ) : (
            <div className="workspace-switcher-empty">暂无团队空间</div>
          )}
        </div>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className="workspace-brand"
        aria-label="切换工作空间"
        aria-controls="workspace-switcher-popover"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        O
      </button>
    </div>
  );
}
