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
        email: "ada@example.com",
        display_name: "Ada",
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
        email: "ada@example.com",
        display_name: "Ada",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
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
        email: "ada@example.com",
        display_name: "Ada",
        created_at_ms: 1710000000000,
        updated_at_ms: 1710000000000,
      },
    });

    store.getState().setAccessToken("new-access-token");

    const restored = createAuthStore();

    expect(restored.getState().accessToken).toBe("new-access-token");
    expect(restored.getState().refreshToken).toBe("refresh-token");
    expect(restored.getState().user?.email).toBe("ada@example.com");
  });
});
