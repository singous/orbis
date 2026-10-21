import { newUUID } from "../ids";
import { createStore } from "zustand/vanilla";
import { userSchema, workspaceSchema, type User, type Workspace } from "../api/schemas";
import type { SessionTokens } from "../api/api-client";
export const AUTH_STORAGE_KEY = "orbis.auth.v2";
export type AuthSession = { accessToken: string; refreshToken: string; user: User; workspace: Workspace | null };
type PersistedSession = AuthSession & { credentialID: string };
export type AuthState = {
  sessionGeneration: number;
  credentialID: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  workspace: Workspace | null;
  setSession: (session: AuthSession) => void;
  syncSession: () => void;
  updateUser: (user: User, sessionKey: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  refreshSession: (credentialID: string | null, originalRefresh: string, refresh: () => Promise<SessionTokens | null>) => Promise<SessionTokens | null>;
  clearSession: () => void;
};
export function getAuthSessionKey(state: AuthState): string {
  return JSON.stringify([state.sessionGeneration, state.user?.id ?? null, state.workspace?.id ?? null, state.workspace?.role ?? null]);
}
function getStorage(): Storage | null { try{return typeof window === "undefined" ? null : window.localStorage;}catch{return null;} }
function readSession(): PersistedSession | null | undefined {
  const storage = getStorage();
  if (!storage) return undefined;
  let raw:string|null;
  try{raw=storage.getItem(AUTH_STORAGE_KEY);}catch{return undefined;}
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || typeof parsed.credentialID !== "string") return null;
    return { ...parsed, user: userSchema.parse(parsed.user), workspace: parsed.workspace === null ? null : workspaceSchema.parse(parsed.workspace) };
  } catch { return null; }
}
function writeSession(session: PersistedSession) { try{getStorage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));}catch{ /* The current session remains usable when persistence is unavailable. */ } }
function storedIdentity(): { credentialID: string | null; revoked?: boolean } | null {
  try { const value = JSON.parse(getStorage()?.getItem(AUTH_STORAGE_KEY) ?? "null"); return value && typeof value === "object" ? value : null; }
  catch { return null; }
}
function persist(state: AuthState, change: Partial<PersistedSession>): PersistedSession|null {
  if (!state.accessToken || !state.refreshToken || !state.user || !state.credentialID) return null;
  const stored = storedIdentity();
  if (stored && (stored.credentialID !== state.credentialID || stored.revoked)) return null;
  const saved=readSession();
  const candidate=change.user??state.user;
  const user=saved&&saved.user.profile_version>candidate.profile_version?saved.user:candidate;
  const next={accessToken:state.accessToken,refreshToken:state.refreshToken,workspace:state.workspace,credentialID:state.credentialID,...change,user};
  if(saved!==undefined)writeSession(next);
  return next;
}

export function createAuthStore() {
  const session = readSession();
  return createStore<AuthState>((set, get) => ({
    sessionGeneration: 0, credentialID: session?.credentialID ?? null,
    accessToken: session?.accessToken ?? null, refreshToken: session?.refreshToken ?? null,
    user: session?.user ?? null, workspace: session?.workspace ?? null,
    setSession: next => {
      const current = get();
      // Choosing another workspace retains the account credential and its cross-tab rotation identity.
      const credentialID = current.user?.id === next.user.id && current.accessToken === next.accessToken && current.refreshToken === next.refreshToken && current.credentialID
        ? current.credentialID : newUUID();
      let user=next.user;
      if(credentialID===current.credentialID){
        for(const candidate of [current.user,readSession()?.user])if(candidate&&candidate.id===user.id&&candidate.profile_version>user.profile_version)user={...candidate,preferred_workspace_id:next.user.preferred_workspace_id};
      }
      writeSession({ ...next,user, credentialID });
      set({ ...next,user, credentialID, sessionGeneration: current.sessionGeneration + 1 });
    },
    syncSession: () => {
      const next = readSession(), current = get();
      if(next===undefined)return;
      if (!next) {
        if (current.credentialID) set({ credentialID: null, accessToken: null, refreshToken: null, user: null, workspace: null, sessionGeneration: current.sessionGeneration + 1 });
        return;
      }
      if (next.credentialID === current.credentialID) {
        // Workspace selection is local to the tab; shared account credentials may rotate elsewhere.
        set({ accessToken: next.accessToken, refreshToken: next.refreshToken, user: current.user&&current.user.profile_version>next.user.profile_version?current.user:next.user });
      } else set({ ...next, sessionGeneration: current.sessionGeneration + 1 });
    },
    updateUser: (user, key) => set(current => {
      if (getAuthSessionKey(current) !== key || user.id !== current.user?.id || user.profile_version < current.user.profile_version) return current;
      const next=persist(current,{user});
      return next?{user:next.user}:current;
    }),
    setTokens: (accessToken, refreshToken) => set(current => {
      if (!current.refreshToken || !current.user || (current.accessToken === accessToken && current.refreshToken === refreshToken)) return current;
      const next=persist(current,{accessToken,refreshToken});
      return next?{accessToken,refreshToken,user:next.user}:current;
    }),
    refreshSession: async (credentialID, originalRefresh, refresh) => {
      const rotate = async () => {
        const stored = readSession();
        if (get().credentialID !== credentialID || (stored && stored.credentialID !== credentialID)) return null;
        const tokens = stored && stored.refreshToken !== originalRefresh
          ? { accessToken: stored.accessToken, refreshToken: stored.refreshToken } : await refresh();
        // Persist before releasing the browser lock, including when the initiating reader was canceled.
        if (tokens && get().credentialID === credentialID) get().setTokens(tokens.accessToken, tokens.refreshToken);
        return tokens;
      };
      if (typeof navigator !== "undefined" && navigator.locks) {
        return navigator.locks.request("orbis.auth.refresh", { signal: AbortSignal.timeout(20_000) }, rotate);
      }
      return rotate();
    },
    clearSession: () => {
      const current = get(), stored = storedIdentity();
      // Retain only a non-secret tombstone so a delayed tab cannot resurrect a cleared session.
      if (!stored || stored.credentialID === current.credentialID) {try{getStorage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify({ credentialID: current.credentialID, revoked: true }));}catch{ /* Server revocation and in-memory sign-out still complete. */ }}
      set({ sessionGeneration: current.sessionGeneration + 1, credentialID: null, accessToken: null, refreshToken: null, user: null, workspace: null });
    },
  }));
}
export const authStore = createAuthStore();
