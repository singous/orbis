import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { BoardImages } from "./images";
import { registerBoardNavigation } from "./navigation";
import { BoardSession } from "./session";

type SessionOptions = {
  pageID: string;
  blockID?: string;
  sessionRef?: RefObject<Pick<BoardSession, "getSnapshot"> | null>;
};

/** Own network/session resources independently of canvas tools and editor panels. */
export function useBoardSession(id: string, embed?: SessionOptions) {
  const auth = useAuthRequest();
  const authRef = useRef(auth);
  authRef.current = auth;
  const credential = useStore(authStore, state => state.credentialID);
  const user = useStore(authStore, state => state.user?.id);
  const workspace = useStore(authStore, state => state.workspace);
  // Token refresh updates the request callback without replacing the editing session.
  const session = useMemo(() => new BoardSession(id, () => authRef.current), [id, credential, auth.workspaceId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const images = useRef<BoardImages | null>(null);

  useLayoutEffect(() => {
    const target = embed?.sessionRef;
    if (!target) return;
    target.current = session;
    return () => { if (target.current === session) target.current = null; };
  }, [session, embed?.sessionRef]);

  useEffect(() => {
    const cache = new BoardImages(() => authRef.current);
    images.current = cache;
    return () => { cache.dispose(); if (images.current === cache) images.current = null; };
  }, [credential, auth.workspaceId]);

  useEffect(() => {
    void session.start(embed?.pageID ?? new URLSearchParams(location.search).get("page") ?? "");
    return () => session.dispose();
  }, [session, embed?.pageID]);

  useEffect(() => registerBoardNavigation({ blockId: embed?.blockID, subscribe: session.subscribe, getSnapshot: session.getSnapshot }), [session, embed?.blockID]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [session]);

  return { auth, workspace, user, session, state, images };
}
