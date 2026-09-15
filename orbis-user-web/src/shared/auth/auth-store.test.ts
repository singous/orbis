import { beforeEach, describe, expect, it } from "vitest";

import { createAuthStore } from "./auth-store";

describe("auth store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists authenticated sessions", () => {
    const store = createAuthStore();

    store.getState().setSession({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        id: "018ff7c4-a5b6-7000-8000-000000000001",
        tenant_id: null,
        email: "ada@example.com",
        display_name: "Ada",
        current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
        status: "active",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
      workspace: {
        id: "018ff7c4-a5b6-7000-8000-000000000002",
        name: "Private workspace",
        workspace_type: "private",
        role: "owner",
        is_current: true,
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
      user: {
        id: "018ff7c4-a5b6-7000-8000-000000000001",
        tenant_id: null,
        email: "ada@example.com",
        display_name: "Ada",
        current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
        status: "active",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
      workspace: null,
    });

    store.getState().clearSession();

    expect(store.getState().accessToken).toBeNull();
    expect(store.getState().refreshToken).toBeNull();
    expect(store.getState().user).toBeNull();
    expect(localStorage.getItem("orbis.auth")).toBeNull();
  });

  it("updates persisted access tokens after a refresh", () => {
    const store = createAuthStore();
    store.getState().setSession({
      accessToken: "old-access-token",
      refreshToken: "refresh-token",
      user: {
        id: "018ff7c4-a5b6-7000-8000-000000000001",
        tenant_id: null,
        email: "ada@example.com",
        display_name: "Ada",
        current_workspace_id: "018ff7c4-a5b6-7000-8000-000000000002",
        status: "active",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
      workspace: null,
    });

    store.getState().setAccessToken("new-access-token");

    const restored = createAuthStore();

    expect(restored.getState().accessToken).toBe("new-access-token");
    expect(restored.getState().refreshToken).toBe("refresh-token");
    expect(restored.getState().user?.email).toBe("ada@example.com");
  });

  it("advances the session generation on logout and same-account login but not refresh", () => {
    const store = createAuthStore();
    const session = {
      accessToken: "access-token", refreshToken: "refresh-token",
      user: { id: "account-a", tenant_id: null, email: "a@example.com", display_name: "A", current_workspace_id: null, status: "active", created_at_ms: 1, updated_at_ms: 1 },
      workspace: null,
    };
    const initialGeneration = store.getState().sessionGeneration;
    store.getState().setSession(session);
    const loginGeneration = store.getState().sessionGeneration;
    expect(loginGeneration).toBe(initialGeneration + 1);
    store.getState().setAccessToken("refreshed-access");
    expect(store.getState().sessionGeneration).toBe(loginGeneration);
    store.getState().setSession(session);
    expect(store.getState().sessionGeneration).toBe(loginGeneration + 1);
    store.getState().clearSession();
    expect(store.getState().sessionGeneration).toBe(loginGeneration + 2);
  });
});
