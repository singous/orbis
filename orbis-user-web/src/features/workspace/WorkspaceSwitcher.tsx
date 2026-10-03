import { Popover } from "@heroui/react/popover";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { UserAvatar, identityColor } from "../../shared/ui/UserAvatar";
import { Boxes, Check, ChevronDown, Orbit } from "../../shared/ui/icons";
import { listWorkspaces, switchWorkspace } from "./api";
import { workspaceRoleLabel } from "./capabilities";

/** The shell supplies the anchor; discovery mounts only after explicit opening. */
export function WorkspaceSwitcher({ variant = "topbar" }: { variant?: "topbar" | "rail" }) {
  const workspace = useStore(authStore, state => state.workspace);
  const authenticated = useStore(authStore, state => Boolean(state.accessToken));
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const location = useLocation();
  const [requestedOpen, setOpen] = useState<{ sessionKey: string; locationKey: string } | null>(null);
  const open = authenticated && requestedOpen?.sessionKey === sessionKey && requestedOpen.locationKey === location.key;
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    setOpen(current => current && (current.sessionKey !== sessionKey || current.locationKey !== location.key) ? null : current);
  }, [sessionKey, location.key]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [open, close]);

  return <div className={`workspace-switcher${variant === "rail" ? " workspace-switcher--rail" : ""}`}>
    <Popover isOpen={open} onOpenChange={next => setOpen(next ? { sessionKey, locationKey: location.key } : null)}>
      <ActionButton type="button" className={variant === "rail" ? "rail-brand workspace-switcher-rail-trigger" : "workspace-brand"} aria-label="切换工作空间" disabled={!authenticated}>
        {variant === "rail" ? <Orbit aria-hidden="true" size={28} strokeWidth={1.8} /> : <>
          <span className="workspace-brand-mark identity-mark" style={identityColor(workspace?.id || "orbis")}><Boxes size={16} aria-hidden="true" /></span>
          <span className="workspace-brand-word">{workspace?.name ?? "Orbis"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>}
      </ActionButton>
      <Popover.Content className={`workspace-switcher-popover${variant === "rail" ? " workspace-switcher-popover--rail" : ""}`} placement={variant === "rail" ? "right top" : "bottom start"} shouldFlip offset={12}>
        <Popover.Dialog className="workspace-switcher-dialog" aria-label="切换工作空间">
          {open ? <WorkspaceChoices key={`${sessionKey}:${location.key}`} onClose={close} /> : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  </div>;
}

function WorkspaceChoices({ onClose }: { onClose: () => void }) {
  const auth = useAuthRequest();
  const authRef = useRef(auth);
  authRef.current = auth;
  const user = useStore(authStore, state => state.user);
  const workspace = useStore(authStore, state => state.workspace);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const navigate = useNavigate();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"preparing" | "committing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeSwitch = useRef<AbortController | null>(null);
  const memberships = useQuery({
    queryKey: ["workspaces", sessionKey],
    queryFn: ({ signal }) => listWorkspaces(auth, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => () => { activeSwitch.current?.abort(); }, []);

  function cancelSwitch() {
    activeSwitch.current?.abort();
    activeSwitch.current = null;
    setPendingId(null);
    setPhase(null);
    setError(null);
  }

  async function selectWorkspace(id: string) {
    if (activeSwitch.current) return;
    if (id === workspace?.id) { onClose(); return; }
    const controller = new AbortController();
    activeSwitch.current = controller;
    setPendingId(id);
    setPhase("preparing");
    setError(null);
    const sourceSession = sessionKey;
    try {
      await preparePendingNavigation(controller.signal);
      if (controller.signal.aborted || getAuthSessionKey(authStore.getState()) !== sourceSession) return;
      setPhase("committing");
      const result = await switchWorkspace(id, authRef.current, controller.signal);
      let current = authStore.getState();
      if (controller.signal.aborted || getAuthSessionKey(current) !== sourceSession || !current.accessToken || !current.refreshToken) return;
      if (result.workspace.id !== id || result.user.id !== current.user?.id) throw new Error("工作空间响应与所选目标不一致，请重试。");
      // A delayed response must not discard a draft edited while the request was pending.
      await preparePendingNavigation(controller.signal);
      current = authStore.getState();
      if (controller.signal.aborted || getAuthSessionKey(current) !== sourceSession || !current.accessToken || !current.refreshToken) return;
      onClose();
      // AppProviders replaces the query client and all observers at this boundary.
      current.setSession({ accessToken: current.accessToken, refreshToken: current.refreshToken, ...result });
      navigate("/documents", { replace: true });
    } catch (cause) {
      if (!controller.signal.aborted && getAuthSessionKey(authStore.getState()) === sourceSession) {
        setError(cause instanceof Error ? cause.message : "切换失败，请检查当前内容后重试。");
      }
    } finally {
      if (activeSwitch.current === controller) activeSwitch.current = null;
      if (!controller.signal.aborted) { setPendingId(null); setPhase(null); }
    }
  }

  const items = memberships.data?.items ?? [];
  return <>
    <div className="workspace-switcher-item workspace-switcher-account">
      <UserAvatar user={user} className="workspace-switcher-avatar" />
      <span className="min-w-0 flex-1"><span className="workspace-switcher-name truncate">{user?.display_name || user?.email || "Orbis"}</span><span className="workspace-switcher-sub">选择当前工作空间</span></span>
    </div>
    {memberships.isPending ? <LoadingState label="正在加载工作空间…" compact /> : null}
    {memberships.isError ? <StatusMessage tone="error" title="工作空间加载失败" role="alert"><Button size="sm" onClick={() => void memberships.refetch()}>重新加载工作空间</Button></StatusMessage> : null}
    {error ? <StatusMessage tone="error" title="无法切换工作空间" role="alert">{error}</StatusMessage> : null}
    {memberships.isSuccess && workspace && !items.some(item => item.id === workspace.id) ? <p className="workspace-switcher-empty">当前工作空间不可用，请选择另一个空间。</p> : null}
    <ul className="workspace-switcher-list" aria-label="可用工作空间">
      {items.map(item => <li key={item.id}>
        <ActionButton type="button" className="workspace-switcher-item workspace-switcher-option w-full justify-start text-left" aria-label={`切换到 ${item.name}`} aria-current={item.id === workspace?.id ? "true" : undefined} disabled={Boolean(pendingId)} onClick={() => void selectWorkspace(item.id)}>
          <span className="workspace-switcher-space-icon identity-mark" style={identityColor(item.id)}><Boxes aria-hidden="true" size={16} /></span>
          <span className="min-w-0 flex-1"><span className="workspace-switcher-name truncate">{item.name}</span><span className="workspace-switcher-sub">{item.workspace_type === "private" ? "私人空间" : "团队空间"} · {workspaceRoleLabel(item.role)}</span></span>
          {item.id === workspace?.id ? <Check aria-hidden="true" size={16} className="workspace-switcher-check" /> : null}
        </ActionButton>
      </li>)}
    </ul>
    {memberships.isSuccess && !items.length ? <p className="workspace-switcher-empty">暂无可访问的工作空间。</p> : null}
    {pendingId ? <div className="workspace-switcher-pending"><span role="status">{phase === "preparing" ? "正在保存当前内容…" : "正在完成工作空间切换…"}</span><Button size="sm" variant="ghost" onClick={cancelSwitch}>{phase === "preparing" ? "取消切换" : "留在当前空间"}</Button></div> : null}
  </>;
}
