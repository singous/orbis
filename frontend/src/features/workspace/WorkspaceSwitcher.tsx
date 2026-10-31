import { cn } from "@orbis/ui/cn";
import { railControlClassName } from "./workspace-chrome";
import { reportError } from "../../shared/api/request-feedback";
import { Popover, PopoverTrigger, PopoverContent } from "@orbis/ui/popover";
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

import { UserAvatar, identityColor } from "../../shared/ui/UserAvatar";
import { OrbisLogo } from "../../shared/ui/OrbisLogo";
import { Boxes, Check, ChevronDown } from "../../shared/ui/icons";
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

  return <div className={cn("workspace-switcher relative min-w-0", variant === "rail" && "workspace-switcher--rail flex-none")}>
    <Popover open={open} onOpenChange={next => setOpen(next ? { sessionKey, locationKey: location.key } : null)}>
      <PopoverTrigger type="button" className={variant === "rail" ? cn(railControlClassName, "rail-brand workspace-switcher-rail-trigger mb-9 text-ob-foreground in-has-[.rail-create-entry]:mb-4") : "workspace-brand flex min-h-(--ob-control-height-sm) min-w-0 max-w-[250px] items-center gap-2 text-sm font-medium text-ob-foreground max-[1200px]:max-w-[220px] max-[768px]:max-w-[145px] max-[768px]:text-ob-caption [&>svg]:flex-none [&>svg]:text-(--ob-page-muted-foreground)"} aria-label="切换工作空间" disabled={!authenticated}>
        {variant === "rail" ? <OrbisLogo size={32} /> : <>
          <span className="workspace-brand-mark identity-mark grid size-6 flex-none place-items-center rounded-[6px] bg-[color-mix(in_oklab,var(--identity-color)_14%,var(--ob-surface))] text-(--identity-color)" style={identityColor(workspace?.id || "orbis")}><Boxes size={16} aria-hidden="true" /></span>
          <span className="workspace-brand-word truncate">{workspace?.name ?? "Orbis"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>}
      </PopoverTrigger>
      <PopoverContent aria-label="切换工作空间" className={cn("workspace-switcher-popover flex max-h-(--workspace-switcher-max-height) w-[268px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-2 [--workspace-switcher-max-height:min(32rem,calc(100dvh-24px))]", variant === "rail" && "workspace-switcher-popover--rail w-[min(268px,calc(100vw-80px))]")} side={variant === "rail" ? "right" : "bottom"} align="start" sideOffset={12}>
        <div className="workspace-switcher-dialog flex max-h-[calc(var(--workspace-switcher-max-height)-16px)] min-h-0 min-w-0 flex-auto flex-col overflow-y-auto overscroll-contain p-0 outline-none">
          {open ? <WorkspaceChoices key={`${sessionKey}:${location.key}`} onClose={close} /> : null}
        </div>
      </PopoverContent>
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

  }

  async function selectWorkspace(id: string) {
    if (activeSwitch.current) return;
    if (id === workspace?.id) { onClose(); return; }
    const controller = new AbortController();
    activeSwitch.current = controller;
    setPendingId(id);
    setPhase("preparing");

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
        reportError(cause);
      }
    } finally {
      if (activeSwitch.current === controller) activeSwitch.current = null;
      if (!controller.signal.aborted) { setPendingId(null); setPhase(null); }
    }
  }

  const items = memberships.data?.items ?? [];
  return <>
    <div className="workspace-switcher-item workspace-switcher-account mb-2 flex flex-none items-center gap-2.5 border-b border-ob-border px-3 pt-2 pb-3">
      <UserAvatar user={user} className="workspace-switcher-avatar flex-none" />
      <span className="min-w-0 flex-1"><span className="workspace-switcher-name block truncate text-sm font-medium text-ob-foreground">{user?.display_name || user?.email || "Orbis"}</span><span className="workspace-switcher-sub mt-0.5 block text-ob-caption text-ob-muted-foreground">选择当前工作空间</span></span>
    </div>
    {memberships.isPending ? <LoadingState label="正在加载工作空间…" compact /> : null}

    {memberships.isSuccess && workspace && !items.some(item => item.id === workspace.id) ? <p className="workspace-switcher-empty px-2.5 pt-[5px] pb-3 text-ob-caption text-(--ob-page-muted-foreground)">当前工作空间不可用，请选择另一个空间。</p> : null}
    <ul className="workspace-switcher-list m-0 min-h-0 min-w-0 list-none overflow-y-auto overscroll-contain p-0 [&>li+li]:mt-1" aria-label="可用工作空间">
      {items.map(item => <li key={item.id}>
        <ActionButton type="button" className="workspace-switcher-item workspace-switcher-option flex h-auto min-h-(--ob-control-height-md) min-w-0 w-full items-center justify-start gap-2 rounded-ob-lg bg-transparent px-3 py-2 text-left whitespace-normal text-ob-foreground aria-current:bg-(--ob-item-selected-bg) [&:not(:disabled):is(:hover,:focus-visible,[aria-current=true])]:bg-(--ob-item-hover-bg) [&:not(:disabled):is(:hover,:focus-visible,[aria-current=true])]:text-(--ob-item-foreground) [&:not(:disabled):is(:hover,:focus-visible,[aria-current=true])_:is(.workspace-switcher-name,.workspace-switcher-space-icon,.workspace-switcher-check,svg)]:text-inherit focus-visible:outline-offset-[-2px]" aria-label={`切换到 ${item.name}`} aria-current={item.id === workspace?.id ? "true" : undefined} disabled={Boolean(pendingId)} onClick={() => void selectWorkspace(item.id)}>
          <span className="workspace-switcher-space-icon identity-mark grid size-[33px] flex-none place-items-center rounded-[9px] bg-[color-mix(in_oklab,var(--identity-color)_14%,var(--ob-surface))] text-sm text-(--identity-color)" style={identityColor(item.id)}><Boxes aria-hidden="true" size={16} /></span>
          <span className="min-w-0 flex-1"><span className="workspace-switcher-name block truncate text-sm font-medium text-ob-foreground">{item.name}</span><span className="workspace-switcher-sub mt-0.5 block text-ob-caption text-ob-muted-foreground">{workspaceRoleLabel(item.role)}</span></span>
          {item.id === workspace?.id ? <Check aria-hidden="true" size={16} className="workspace-switcher-check flex-none text-(--ob-page-muted-foreground)" /> : null}
        </ActionButton>
      </li>)}
    </ul>
    {memberships.isSuccess && !items.length ? <p className="workspace-switcher-empty px-2.5 pt-[5px] pb-3 text-ob-caption text-(--ob-page-muted-foreground)">暂无可访问的工作空间。</p> : null}
    {pendingId ? <div className="workspace-switcher-pending mt-2 flex flex-none items-center justify-between gap-2 border-t border-ob-border px-1 pt-2 text-ob-caption [&>span]:min-w-0 [&>span]:flex-1"><span role="status">{phase === "preparing" ? "正在保存当前内容…" : "正在完成工作空间切换…"}</span><Button size="sm" variant="ghost" onClick={cancelSwitch}>{phase === "preparing" ? "取消切换" : "留在当前空间"}</Button></div> : null}
  </>;
}
