import { createStore } from "zustand/vanilla";

import type { User, Workspace } from "../api/schemas";

const STORAGE_KEY = "orbis.auth";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: User;
  workspace: Workspace | null;
};

export type AuthState = {
  sessionGeneration: number;
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  workspace: Workspace | null;
  setSession: (session: AuthSession) => void;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
};

export function getAuthSessionKey(state: AuthState): string {
  return JSON.stringify([
    state.sessionGeneration,
    state.user?.id ?? null,
    state.user?.tenant_id ?? null,
    state.user?.current_workspace_id ?? null,
    state.workspace?.id ?? null,
    state.workspace?.role ?? null,
  ]);
}

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readSession(): AuthSession | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeSession(session: AuthSession): void {
  getStorage()?.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function createAuthStore() {
  const session = readSession();

  return createStore<AuthState>((set) => ({
    // Runtime-only generation distinguishes a fresh login by the same account.
    sessionGeneration: 0,
    accessToken: session?.accessToken ?? null,
    refreshToken: session?.refreshToken ?? null,
    user: session?.user ?? null,
    workspace: session?.workspace ?? null,
    setSession: (nextSession) => {
      writeSession(nextSession);
      set((current) => ({
        sessionGeneration: current.sessionGeneration + 1,
        accessToken: nextSession.accessToken,
        refreshToken: nextSession.refreshToken,
        user: nextSession.user,
        workspace: nextSession.workspace,
      }));
    },
    setAccessToken: (accessToken) => {
      set((current) => {
        if (!current.refreshToken || !current.user) {
          return current;
        }
        writeSession({
          accessToken,
          refreshToken: current.refreshToken,
          user: current.user,
          workspace: current.workspace,
        });
        return { accessToken };
      });
    },
    clearSession: () => {
      getStorage()?.removeItem(STORAGE_KEY);
      set((current) => ({
        sessionGeneration: current.sessionGeneration + 1,
        accessToken: null, refreshToken: null, user: null, workspace: null,
      }));
    },
  }));
}

export const authStore = createAuthStore();
