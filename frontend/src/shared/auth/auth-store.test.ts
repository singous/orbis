import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthSessionKey, createAuthStore } from "./auth-store";

describe("auth store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists authenticated sessions", () => {
    const store = createAuthStore();

    store.getState().setSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {bio: null, avatar_asset_id: null, profile_version: 1,
        id: "018ff7c4-a5b6-7000-8000-000000000001",
        email: "ada@example.com",
        display_name: "Ada",
        preferred_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
      workspace: {
        id: "018ff7c4-a5b6-7000-8000-000000000002",
        name: "Private workspace",
        role: "owner",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
    });

    const restored = createAuthStore();

    expect(restored.getState().accessToken).toBe("access-token");
    expect(restored.getState().user?.email).toBe("ada@example.com");
  });

  it("clears tokens and user identity on logout", () => {
    const store = createAuthStore();
    store.getState().setSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {bio: null, avatar_asset_id: null, profile_version: 1,
        id: "018ff7c4-a5b6-7000-8000-000000000001",
        email: "ada@example.com",
        display_name: "Ada",
        preferred_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
      workspace: null,
    });

    store.getState().clearSession();

    expect(store.getState().accessToken).toBeNull();
    expect(store.getState().refreshToken).toBeNull();
    expect(store.getState().user).toBeNull();
    expect(JSON.parse(localStorage.getItem("orbis.auth.v2")!)).toMatchObject({ revoked: true });
  });

  it("updates persisted access tokens after a refresh", () => {
    const store = createAuthStore();
    store.getState().setSession({
      accessToken: "old-access-token",
      refreshToken: "refresh-token",
      user: {bio: null, avatar_asset_id: null, profile_version: 1,
        id: "018ff7c4-a5b6-7000-8000-000000000001",
        email: "ada@example.com",
        display_name: "Ada",
        preferred_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
      workspace: null,
    });

    store.getState().setTokens("new-access-token", "rotated-refresh-token");

    const restored = createAuthStore();

    expect(restored.getState().accessToken).toBe("new-access-token");
    expect(restored.getState().refreshToken).toBe("rotated-refresh-token");
    expect(restored.getState().user?.email).toBe("ada@example.com");
  });

  it("advances the session generation on logout and same-account login but not refresh", () => {
    const store = createAuthStore();
    const session = {
      accessToken: "access-token", refreshToken: "refresh-token",
      user: {bio: null, avatar_asset_id: null, profile_version: 1,  id: "018ff7c4-a5b6-7000-8000-000000000001", email: "a@example.com", display_name: "A", preferred_workspace_id: null, created_at_ms: 1, updated_at_ms: 1 },
      workspace: null,
    };
    const initialGeneration = store.getState().sessionGeneration;
    store.getState().setSession(session);
    const loginGeneration = store.getState().sessionGeneration;
    expect(loginGeneration).toBe(initialGeneration + 1);
    store.getState().setTokens("refreshed-access", "rotated-refresh-token");
    expect(store.getState().sessionGeneration).toBe(loginGeneration);
    store.getState().setSession(session);
    expect(store.getState().sessionGeneration).toBe(loginGeneration + 1);
    store.getState().clearSession();
    expect(store.getState().sessionGeneration).toBe(loginGeneration + 2);
  });
  it("persists profile changes without resetting the session and rejects late responses", () => {
    const store = createAuthStore();
    const session = { accessToken: "access", refreshToken: "refresh", workspace: null,
      user: {bio: null, avatar_asset_id: null, profile_version: 1,  id: "018ff7c4-a5b6-7000-8000-000000000001", email: "a@example.com", display_name: "A", preferred_workspace_id: null, created_at_ms: 1, updated_at_ms: 1 } };
    store.getState().setSession(session);
    const key = getAuthSessionKey(store.getState());
    store.getState().updateUser({ ...session.user, display_name: "Updated", bio: "My notes" }, key);
    expect(getAuthSessionKey(store.getState())).toBe(key);
    expect(createAuthStore().getState().user?.bio).toBe("My notes");
    store.getState().setSession(session);
    store.getState().updateUser({ ...session.user, display_name: "Late response" }, key);
    expect(store.getState().user?.display_name).toBe("A");
  });

});


afterEach(() => vi.unstubAllGlobals());
it("serializes rotation across tabs and observes credentials persisted by the first tab", async () => {
  localStorage.clear();
  const first = createAuthStore();
  first.getState().setSession({ accessToken: "initial-access", refreshToken: "initial-refresh", workspace: null,
    user: { id: "018ff7c4-a5b6-7000-8000-000000000001", email: "test@example.test", display_name: "Test", bio: null, avatar_asset_id: null, preferred_workspace_id: null, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 } });
  const second = createAuthStore();
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, _options: unknown, callback: () => Promise<unknown>) => {
    const result = tail.then(callback);
    tail = result.then(() => undefined);
    return result;
  } } });
  const rotate = vi.fn(async () => {
    await Promise.resolve();
    return { accessToken: "new-access", refreshToken: "new-refresh" };
  });
  const original = first.getState().credentialID;
  const results = await Promise.all([first.getState().refreshSession(original, "initial-refresh", rotate), second.getState().refreshSession(original, "initial-refresh", rotate)]);
  expect(rotate).toHaveBeenCalledTimes(1);
  expect(results[0]).toEqual(results[1]);
  expect(first.getState().refreshToken).toBe("new-refresh");
  expect(second.getState().refreshToken).toBe("new-refresh");
  expect(createAuthStore().getState().refreshToken).toBe("new-refresh");
});
it("keeps a newer tab login intact when an old tab signs out", () => {
  localStorage.clear();
  const first = createAuthStore();
  const user = { id: "018ff7c4-a5b6-7000-8000-000000000001", email: "test@example.test", display_name: null, bio: null, avatar_asset_id: null, preferred_workspace_id: null, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 };
  first.getState().setSession({ user, workspace: null, accessToken: "first-access", refreshToken: "first-refresh" });
  const second = createAuthStore();
  second.getState().setSession({ user, workspace: null, accessToken: "second-access", refreshToken: "second-refresh" });
  first.getState().clearSession();
  expect(createAuthStore().getState().refreshToken).toBe("second-refresh");
});

it("does not let a delayed other-tab rotation resurrect a signed-out credential", () => {
  localStorage.clear();
  const first = createAuthStore();
  first.getState().setSession({ accessToken: "first-access", refreshToken: "first-refresh", workspace: null,
    user: { id: "018ff7c4-a5b6-7000-8000-000000000001", email: "test@example.test", display_name: null, bio: null, avatar_asset_id: null, preferred_workspace_id: null, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 } });
  const second = createAuthStore();
  first.getState().clearSession();
  second.getState().setTokens("delayed-access", "delayed-refresh");
  expect(createAuthStore().getState().accessToken).toBeNull();
  expect(localStorage.getItem("orbis.auth.v2")).not.toContain("delayed-refresh");
  second.getState().syncSession();
  expect(second.getState().accessToken).toBeNull();
});

it("does not overwrite a newer cross-tab profile while persisting rotated credentials",()=>{
  localStorage.clear();
  const first=createAuthStore();
  const user={id:"018ff7c4-a5b6-7000-8000-000000000001",email:"test@example.test",display_name:"Before",bio:null,avatar_asset_id:null,preferred_workspace_id:null,profile_version:1,created_at_ms:1000,updated_at_ms:1000};
  first.getState().setSession({user,workspace:null,accessToken:"access",refreshToken:"refresh"});
  const second=createAuthStore();
  first.getState().updateUser({...user,display_name:"After",profile_version:2,updated_at_ms:10},getAuthSessionKey(first.getState()));
  second.getState().setTokens("rotated-access","rotated-refresh");
  expect(second.getState().user?.display_name).toBe("After");
  expect(createAuthStore().getState().user?.profile_version).toBe(2);
});

it("keeps rotation and sign-out usable when browser storage is blocked",()=>{
  localStorage.clear();const store=createAuthStore();
  const user={id:"018ff7c4-a5b6-7000-8000-000000000001",email:"storage@example.test",display_name:null,bio:null,avatar_asset_id:null,preferred_workspace_id:null,profile_version:1,created_at_ms:1,updated_at_ms:1};
  store.getState().setSession({user,workspace:null,accessToken:"old-access",refreshToken:"old-refresh"});
  const get=vi.spyOn(localStorage,"getItem").mockImplementation(()=>{throw new Error("Storage blocked");});
  const put=vi.spyOn(localStorage,"setItem").mockImplementation(()=>{throw new Error("Storage blocked");});
  try{
    store.getState().syncSession();expect(store.getState().accessToken).toBe("old-access");
    store.getState().setTokens("rotated-access","rotated-refresh");
    expect(store.getState().refreshToken).toBe("rotated-refresh");
    store.getState().clearSession();expect(store.getState().accessToken).toBeNull();
  }finally{get.mockRestore();put.mockRestore();localStorage.clear();}
});
