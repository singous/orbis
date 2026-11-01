import { useMemo } from "react";
import { useDocumentIndex } from "./queries";

export function useNotebookDocumentCounts() {
  const query = useDocumentIndex("active", { allPages: true });
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const note of query.data?.items ?? []) result.set(note.notebook_id, (result.get(note.notebook_id) ?? 0) + 1);
    return result;
  }, [query.data]);
  return { counts, isSuccess: query.isSuccess };
}
