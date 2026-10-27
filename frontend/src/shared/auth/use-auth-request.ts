import type { ApiRequestOptions, SessionTokens } from "../api/api-client";
import { useMemo } from "react";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "./auth-store";

export type AuthRequestOptions = {
  accessToken: string;
  refreshToken: string | null;
  workspaceId?: string | null;
  feedback?: ApiRequestOptions["feedback"];
  canNotify?: () => boolean;
  onTokenRefresh: (accessToken: string, refreshToken: string) => void;
  onUnauthorized: () => void;
  refreshCoordinator?: (refresh: () => Promise<SessionTokens | null>) => Promise<SessionTokens | null>;
};

export function authRequestOptions(auth: AuthRequestOptions) {
  return { token: auth.accessToken, refreshToken: auth.refreshToken, workspaceId: auth.workspaceId, onTokenRefresh: auth.onTokenRefresh, onUnauthorized: auth.onUnauthorized, refreshCoordinator: auth.refreshCoordinator, feedback: auth.feedback, canNotify: auth.canNotify };
}

export function useOptionalAuthRequest(): AuthRequestOptions | null {
  const state = useStore(authStore);
  return useMemo(() => {
    if (!state.accessToken) return null;
    const sessionKey = getAuthSessionKey(state);
    return {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      workspaceId: state.workspace?.id ?? null,
      canNotify: () => getAuthSessionKey(authStore.getState()) === sessionKey,
      refreshCoordinator: (refresh: () => Promise<SessionTokens | null>) => state.refreshSession(state.credentialID, state.refreshToken!, refresh),
      onTokenRefresh: (accessToken: string, refreshToken: string) => {
        if (authStore.getState().credentialID === state.credentialID) {
          state.setTokens(accessToken, refreshToken);
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
