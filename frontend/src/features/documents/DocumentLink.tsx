import { useContext, useEffect, useRef } from "react";
import { Link, useMatch, type LinkProps } from "react-router-dom";
import { QueryClientContext } from "@tanstack/react-query";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { getNote, getNoteChildrenPage } from "./api";
import { loadDocumentEditor } from "./editor/editor-module";

/** Pointer/focus intent warms one destination without changing link semantics. */
export const DOCUMENT_PREFETCH_DWELL_MS = 150;

export function DocumentLink({ noteId, onPointerEnter, onPointerLeave, onFocus, ...props }: LinkProps & { noteId: string }) {
  const client = useContext(QueryClientContext);
  const auth = useOptionalAuthRequest();
  const isCurrentDocument = useMatch("/documents/:noteId")?.params.noteId === noteId;
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelIntent() {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
  }
  useEffect(() => cancelIntent, [noteId, client, auth, isCurrentDocument]);
  function prefetch() {
    // Hovering the active row must not refetch (or fail) the editing session.
    if (!client || !auth || isCurrentDocument) return;
    void loadDocumentEditor().catch(() => { /* Navigation owns loading feedback. */ });
    void client.prefetchQuery({ queryKey: ["note", noteId], queryFn: ({ signal }) => getNote(noteId, auth, signal) });
    void client.prefetchQuery({ queryKey: ["note-content-pages", noteId], queryFn: ({ signal }) => getNoteChildrenPage(noteId, auth, { signal }) });
  }
  return <Link {...props}
    onPointerEnter={event => {
      onPointerEnter?.(event);
      cancelIntent();
      if (event.pointerType !== "touch") pending.current = setTimeout(() => { pending.current = null; prefetch(); }, DOCUMENT_PREFETCH_DWELL_MS);
    }}
    onPointerLeave={event => { onPointerLeave?.(event); cancelIntent(); }}
    onFocus={event => { onFocus?.(event); cancelIntent(); prefetch(); }}
  />;
}
