import { useMemo } from "react";
import type { Note } from "../../shared/api/schemas";
import { useDocumentIndex } from "./queries";

const NOTEBOOK_PREVIEW_LIMIT = 3;

export function useNotebookDocumentCounts() {
  const query = useDocumentIndex("active", { allPages: true });
  const { counts, recent } = useMemo(() => {
    const counts = new Map<string, number>();
    const recent = new Map<string, Note[]>();
    // The index already returns the newest documents first across its pages.
    for (const note of query.data?.items ?? []) {
      counts.set(note.notebook_id, (counts.get(note.notebook_id) ?? 0) + 1);
      const preview = recent.get(note.notebook_id) ?? [];
      if (preview.length < NOTEBOOK_PREVIEW_LIMIT) {
        preview.push(note);
        recent.set(note.notebook_id, preview);
      }
    }
    return { counts, recent };
  }, [query.data]);
  return { counts, recent, isSuccess: query.isSuccess, isLoading: query.isLoading };
}
