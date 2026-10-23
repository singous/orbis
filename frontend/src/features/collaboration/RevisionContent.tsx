import { useMemo } from "react";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import type { NoteBlocks } from "../../shared/api/schemas";
import { TableHostContext, type TableHost } from "../data-tables/context";
import { ContentRenderer } from "../content/ContentRenderer";
import { AuthenticatedFileContent } from "../files/FileContent";

export function RevisionContent({ noteId, version, blocks }: { noteId: string; version: number; blocks: NoteBlocks }) {
  const auth = useAuthRequest();
  const host = useMemo<TableHost>(() => ({ noteId, auth, readOnly: true, draftScope: "", documentVersion: () => version }), [noteId, auth, version]);
  return <TableHostContext.Provider value={host}><AuthenticatedFileContent><ContentRenderer blocks={blocks} /></AuthenticatedFileContent></TableHostContext.Provider>;
}
