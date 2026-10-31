import { act, cleanup, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authStore } from "../../shared/auth/auth-store";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
import type { BoardSession, SessionState } from "./session";
import { useBoardSession } from "./use-board-session";

const instances = vi.hoisted(() => ({ sessions: [] as Array<{
  id: string; auth: () => AuthRequestOptions; start: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>; getSnapshot: () => SessionState;
}>, images: [] as Array<{ dispose: ReturnType<typeof vi.fn> }> }));
vi.mock("./session", () => ({ BoardSession: class {
  start = vi.fn(async () => {});
  dispose = vi.fn();
  subscribe = () => () => {};
  state: SessionState = { board: null, pageID: "", elements: new Map(), status: "loading", error: null, pending: 0, canUndo: false, canRedo: false, canDiscard: false };
  getSnapshot = () => this.state;
  constructor(public id: string, public auth: () => AuthRequestOptions) { instances.sessions.push(this); }
} }));
vi.mock("./images", () => ({ BoardImages: class {
  dispose = vi.fn();
  constructor() { instances.images.push(this); }
} }));
vi.mock("./navigation", () => ({ registerBoardNavigation: () => () => {} }));
const id = "018ff7c4-a5b6-7000-8000-000000000001";
beforeEach(() => {
  authStore.getState().setSession({ accessToken: "token", refreshToken: "refresh", user: { id, email: "owner@example.com", display_name: "Owner", avatar_asset_id: null, bio: null, profile_version: 1, preferred_workspace_id: id, created_at_ms: 1, updated_at_ms: 1 }, workspace: { id, name: "Workspace", role: "owner", created_at_ms: 1, updated_at_ms: 1 } });
});
afterEach(() => { cleanup(); authStore.getState().clearSession(); instances.sessions.length = 0; instances.images.length = 0; });

it("keeps the board session through token rotation and disposes resources on workspace changes", () => {
  const view = renderHook(() => useBoardSession("board"));
  const initial = instances.sessions[0];
  const images = instances.images[0];
  act(() => authStore.getState().setTokens("rotated", "rotated-refresh"));
  expect(instances.sessions).toHaveLength(1);
  expect(initial.auth().accessToken).toBe("rotated");
  act(() => authStore.setState({ workspace: { ...authStore.getState().workspace!, id: "other-workspace" } }));
  expect(instances.sessions).toHaveLength(2);
  expect(initial.dispose).toHaveBeenCalledOnce();
  expect(images.dispose).toHaveBeenCalledOnce();
  expect(instances.sessions[1].auth().workspaceId).toBe("other-workspace");
  view.unmount();
  expect(instances.sessions[1].dispose).toHaveBeenCalledOnce();
  expect(instances.images[1].dispose).toHaveBeenCalledOnce();
});

it("releases an embedded session handle before replacing or unmounting its board", () => {
  const sessionRef = createRef<Pick<BoardSession, "getSnapshot">>();
  const view = renderHook(({ board }) => useBoardSession(board, { pageID: "page", blockID: "block", sessionRef }), { initialProps: { board: "first" } });
  const first = sessionRef.current;
  expect(first).not.toBeNull();
  expect(instances.sessions[0].start).toHaveBeenCalledWith("page");
  view.rerender({ board: "second" });
  expect(instances.sessions[0].dispose).toHaveBeenCalledOnce();
  expect(sessionRef.current).not.toBe(first);
  view.unmount();
  expect(sessionRef.current).toBeNull();
});
