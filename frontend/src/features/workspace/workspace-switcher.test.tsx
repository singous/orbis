import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../app/providers";
import { authStore } from "../../shared/auth/auth-store";
import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const SOURCE_ID = "018ff7c4-a5b6-7000-8000-000000000001";
const TARGET_ID = "018ff7c4-a5b6-7000-8000-000000000002";
const USER_ID = "018ff7c4-a5b6-7000-8000-000000000003";
const initialRoute = "/documents/source-note?editing=true";
const user = { bio:null,avatar_asset_id:null,profile_version:1,id: USER_ID, email: "owner@orbis.test", display_name: "测试用户", preferred_workspace_id: SOURCE_ID, created_at_ms: 1, updated_at_ms: 1 };
const workspace = { id: SOURCE_ID, name: "团队工作空间", role: "owner" as const, created_at_ms: 1, updated_at_ms: 1 };
const target = { ...workspace, id: TARGET_ID, name: "私人空间", role: "editor" as const };
const session = { accessToken: "source-token", refreshToken: "source-refresh", user, workspace };
const switched = { user: { ...user, preferred_workspace_id: TARGET_ID, updated_at_ms: 2 }, workspace: target };
function response(data: unknown, status = 200) { return new Response(JSON.stringify({ code: status === 200 ? "OK" : "WORKSPACE_FORBIDDEN", message: status === 200 ? "成功" : "目标工作空间已不可用", request_id: "workspace-switch-test", data }), { status, headers: { "Content-Type": "application/json" } }); }
function CurrentPath() { const location = useLocation(); return <output aria-label="当前路径">{location.pathname}{location.search}</output>; }
function SessionProbe({ capture, prepare }: { capture: (client: QueryClient) => void; prepare?: () => Promise<void> }) {
  const client = useQueryClient();
  useEffect(() => capture(client), [capture, client]);
  useEffect(() => prepare ? registerPendingNavigation(prepare) : undefined, [prepare]);
  return <textarea aria-label="当前草稿" defaultValue="未保存的当前内容" />;
}
function renderSwitcher(variant: "topbar" | "rail" = "rail", prepare?: () => Promise<void>) {
  const clients: QueryClient[] = [];
  const capture = (client: QueryClient) => { clients.push(client); };
  const view = render(<MemoryRouter initialEntries={[initialRoute]}><CurrentPath /><AppProviders><WorkspaceSwitcher variant={variant} /><SessionProbe capture={capture} prepare={prepare} /></AppProviders></MemoryRouter>);
  return { ...view, clients, trigger: screen.getByRole("button", { name: "切换工作空间" }), draft: screen.getByRole("textbox", { name: "当前草稿" }), path: screen.getByRole("status", { name: "当前路径" }) };
}
function installApi(post: () => Promise<Response> = async () => response(switched.user), items = [{ ...workspace, is_current: false }, { ...target, is_current: true }]) {
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    expect(new Headers(init.headers).has("X-Workspace-ID")).toBe(false);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer source-token");
    if (input.includes("/v1/workspaces?")) return response({ items,pagination:{page:1,page_size:100,total:items.length} });
    expect(input).toBe("/api/v1/me/workspace-preference");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ workspace_id: TARGET_ID });
    return post();
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
async function chooseTarget(view: ReturnType<typeof renderSwitcher>) {
  await userEvent.click(view.trigger);
  await userEvent.click(await screen.findByRole("button", { name: `切换到 ${target.name}` }));
}
beforeEach(() => { act(() => authStore.getState().setSession(session)); });
afterEach(() => { cleanup(); act(() => authStore.getState().clearSession()); vi.unstubAllGlobals(); });

describe.each(["topbar", "rail"] as const)("WorkspaceSwitcher %s anchor", variant => {
  it("loads memberships only on activation, marks the client-selected workspace and closes with focus intact", async () => {
    const fetch = installApi();
    const actor = userEvent.setup();
    const view = renderSwitcher(variant);
    expect(fetch).not.toHaveBeenCalled();
    await actor.hover(view.trigger);
    expect(fetch).not.toHaveBeenCalled();
    await actor.unhover(view.trigger);
    await actor.tab();
    await actor.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "切换工作空间" });
    expect(await within(dialog).findByRole("button", { name: `切换到 ${workspace.name}` })).toHaveAttribute("aria-current", "true");
    expect(within(dialog).getByRole("button", { name: `切换到 ${target.name}` })).not.toHaveAttribute("aria-current");
    expect(fetch).toHaveBeenCalledTimes(1);
    await actor.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "切换工作空间" })).not.toBeInTheDocument());
    await waitFor(() => expect(view.trigger).toHaveFocus());
    expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
    expect(view.path).toHaveTextContent(initialRoute);
  });

  it("uses the intended trigger and does not save or post when selecting the current workspace", async () => {
    const fetch = installApi();
    const prepare = vi.fn(async () => undefined);
    const view = renderSwitcher(variant, prepare);
    if (variant === "rail") {
      expect(view.trigger).toHaveClass("rail-brand", "workspace-switcher-rail-trigger");
      expect(view.trigger.querySelector('.orbis-logo use')).toHaveAttribute("href", "/brand/orbis-mark.svg#orbis-mark");
    } else expect(view.trigger).toHaveTextContent(workspace.name);
    await userEvent.click(view.trigger);
    await userEvent.click(await screen.findByRole("button", { name: `切换到 ${workspace.name}` }));
    expect(prepare).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(0);
    expect(view.path).toHaveTextContent(initialRoute);
  });
});

it("saves before switching, persists the new context, replaces the query cache and leaves stale resource routes", async () => {
  let finishSave!: () => void;
  const prepare = vi.fn<() => Promise<void>>().mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; })).mockResolvedValue(undefined);
  const fetch = installApi();
  const view = renderSwitcher("rail", prepare);
  const oldClient = view.clients[0];
  oldClient.setQueryData(["source-workspace-private-data"], "source only");
  await chooseTarget(view);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(0);
  expect(view.path).toHaveTextContent(initialRoute);
  expect(view.draft).toHaveValue("未保存的当前内容");
  await act(async () => { finishSave(); });
  await waitFor(() => expect(authStore.getState().workspace?.id).toBe(TARGET_ID));
  expect(view.path).toHaveTextContent("/documents");
  expect(view.path.textContent).not.toContain("source-note");
  expect(JSON.parse(localStorage.getItem("orbis.auth.v2")!)).toMatchObject({user:switched.user,workspace:{id:TARGET_ID,role:"editor"}});
  await waitFor(() => expect(view.clients.at(-1)).not.toBe(oldClient));
  expect(oldClient.getQueryData(["source-workspace-private-data"])).toBeUndefined();
  expect(view.clients.at(-1)?.getQueryData(["source-workspace-private-data"])).toBeUndefined();
  expect(prepare).toHaveBeenCalledTimes(2);
});

it("keeps the source context after a failed save and allows a guarded retry", async () => {
  const prepare = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("当前草稿保存失败")).mockResolvedValueOnce(undefined);
  const fetch = installApi();
  const view = renderSwitcher("rail", prepare);
  await chooseTarget(view);
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("当前草稿保存失败");
  expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(0);
  expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
  expect(view.path).toHaveTextContent(initialRoute);
  expect(view.draft).toHaveValue("未保存的当前内容");
  await userEvent.click(screen.getByRole("button", { name: `切换到 ${target.name}` }));
  await waitFor(() => expect(authStore.getState().workspace?.id).toBe(TARGET_ID));
  expect(prepare).toHaveBeenCalledTimes(3);
});

it.each([false, true])("checks drafts again after a delayed switch response (late save fails: %s)", async lateSaveFails => {
  let finishSwitch!: (response: Response) => void;
  let latestDraft = "初始草稿";
  const savedDrafts: string[] = [];
  const prepare = vi.fn(async () => {
    savedDrafts.push(latestDraft);
    if (lateSaveFails && savedDrafts.length === 2) throw new Error("切换期间的新草稿未能保存");
  });
  installApi(() => new Promise<Response>(resolve => { finishSwitch = resolve; }));
  const view = renderSwitcher("rail", prepare);
  await chooseTarget(view);
  await waitFor(() => expect(finishSwitch).toBeDefined());
  expect(savedDrafts).toEqual(["初始草稿"]);
  latestDraft = "请求期间的新草稿";
  fireEvent.change(view.draft, { target: { value: latestDraft } });
  await act(async () => { finishSwitch(response(switched.user)); });
  expect(savedDrafts).toEqual(["初始草稿", "请求期间的新草稿"]);
  if (lateSaveFails) {
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("切换期间的新草稿未能保存");
    expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
    expect(view.path).toHaveTextContent(initialRoute);
    expect(view.draft).toHaveValue(latestDraft);
  } else {
    await waitFor(() => expect(authStore.getState().workspace?.id).toBe(TARGET_ID));
    expect(view.path).toHaveTextContent("/documents");
  }
});

it("cancels during save without sending a workspace mutation when the save later completes", async () => {
  let finishSave!: () => void;
  const prepare = () => new Promise<void>(resolve => { finishSave = resolve; });
  const fetch = installApi();
  const view = renderSwitcher("rail", prepare);
  await chooseTarget(view);
  await userEvent.click(screen.getByRole("button", { name: "取消切换" }));
  await act(async () => { finishSave(); });
  expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(0);
  expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
  expect(view.path).toHaveTextContent(initialRoute);
  expect(screen.getByRole("button", { name: `切换到 ${target.name}` })).toBeEnabled();
});

it.each(["cancel", "escape", "session"])("ignores a late switch response after %s", async mode => {
  let finishSwitch!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((input: string, init: RequestInit) => {
    if (input.includes("/v1/workspaces?")) return Promise.resolve(response({ items: [workspace, target],pagination:{page:1,page_size:100,total:2} }));
    signal = init.signal;
    return new Promise<Response>(resolve => { finishSwitch = resolve; });
  }));
  const view = renderSwitcher();
  await chooseTarget(view);
  await waitFor(() => expect(signal).toBeDefined());
  if (mode === "cancel") await userEvent.click(screen.getByRole("button", { name: "留在当前空间" }));
  else if (mode === "escape") await userEvent.keyboard("{Escape}");
  else act(() => authStore.getState().setSession({ ...session, accessToken: "new-login-token" }));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => { finishSwitch(response(switched.user)); });
  expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
  expect(authStore.getState().accessToken).toBe(mode === "session" ? "new-login-token" : "source-token");
  expect(view.path).toHaveTextContent(initialRoute);
});

it("keeps the active context if target membership is revoked after discovery", async () => {
  installApi(async () => response(null, 403));
  const view = renderSwitcher();
  await chooseTarget(view);
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("目标工作空间已不可用");
  expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
  expect(view.path).toHaveTextContent(initialRoute);
});

it("can recover through global discovery when the source workspace is no longer in the membership list", async () => {
  installApi(async () => response(switched.user), [{ ...target, is_current: true }]);
  const view = renderSwitcher();
  await userEvent.click(view.trigger);
  expect(await screen.findByText("当前工作空间不可用，请选择另一个空间。")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: `切换到 ${target.name}` }));
  await waitFor(() => expect(authStore.getState().workspace?.id).toBe(TARGET_ID));
});

it("retries membership discovery and aborts it when the selector closes", async () => {
  let attempts = 0;
  let pendingSignal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((_input: string, init: RequestInit) => {
    attempts += 1;
    if (attempts === 1) return Promise.resolve(response(null, 503));
    pendingSignal = init.signal;
    return new Promise<Response>(() => {});
  }));
  const view = renderSwitcher();
  await userEvent.click(view.trigger);
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("工作空间加载失败");
  await userEvent.click(screen.getByRole("button", { name: "重新加载工作空间" }));
  await waitFor(() => expect(pendingSignal).toBeDefined());
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(pendingSignal?.aborted).toBe(true));
  expect(authStore.getState().workspace?.id).toBe(SOURCE_ID);
});
