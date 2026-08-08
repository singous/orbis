import { createStore } from "zustand/vanilla";

import type { User } from "../api/schemas";

const STORAGE_KEY = "orbis.auth";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

export type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setSession: (session: AuthSession) => void;
  setAccessToken: (accessToken: string) => void;
  clearSession: () => void;
};

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
    accessToken: session?.accessToken ?? null,
    refreshToken: session?.refreshToken ?? null,
    user: session?.user ?? null,
    setSession: (nextSession) => {
      writeSession(nextSession);
      set({
        accessToken: nextSession.accessToken,
        refreshToken: nextSession.refreshToken,
        user: nextSession.user,
      });
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
        });
        return { accessToken };
      });
    },
    clearSession: () => {
      getStorage()?.removeItem(STORAGE_KEY);
      set({ accessToken: null, refreshToken: null, user: null });
    },
  }));
}

export const authStore = createAuthStore();
