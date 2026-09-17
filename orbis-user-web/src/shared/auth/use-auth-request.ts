import { useMemo } from "react";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "./auth-store";

export type AuthRequestOptions = {
  accessToken: string;
  refreshToken: string | null;
  onTokenRefresh: (accessToken: string) => void;
  onUnauthorized: () => void;
};

export function authRequestOptions(auth: AuthRequestOptions) {
  return { token: auth.accessToken, refreshToken: auth.refreshToken, onTokenRefresh: auth.onTokenRefresh, onUnauthorized: auth.onUnauthorized };
}

export function useOptionalAuthRequest(): AuthRequestOptions | null {
  const state = useStore(authStore);
  return useMemo(() => {
    if (!state.accessToken) return null;
    const sessionKey = getAuthSessionKey(state);
    return {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      onTokenRefresh: (accessToken: string) => {
        if (getAuthSessionKey(authStore.getState()) === sessionKey) {
          state.setAccessToken(accessToken);
        }
      },
      onUnauthorized: () => {
        if (getAuthSessionKey(authStore.getState()) === sessionKey) {
          state.clearSession();
        }
      },
    };
  }, [state]);
}

export function useAuthRequest(): AuthRequestOptions {
  const auth = useOptionalAuthRequest();
  if (!auth) throw new Error("Authenticated access required");
  return auth;
}
