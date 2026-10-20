import { useCallback, useEffect, useState } from "react";

const storagePrefix = "orbis.collapsedDocumentGroups.";

function readGroups(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Group visibility is a device preference scoped to the current workspace. */
export function useCollapsedGroups(workspaceId: string | undefined) {
  const key = `${storagePrefix}${workspaceId ?? "anonymous"}`;
  const [state, setState] = useState(() => ({ key, ids: readGroups(key) }));
  const ids = state.key === key ? state.ids : readGroups(key);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === key || event.key === null) setState({ key, ids: readGroups(key) });
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  const toggleGroup = useCallback((groupId: string) => {
    setState((current) => {
      const previous = current.key === key ? current.ids : readGroups(key);
      const next = previous.includes(groupId) ? previous.filter((id) => id !== groupId) : [...previous, groupId];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep controls usable when browser storage is unavailable. */ }
      return { key, ids: next };
    });
  }, [key]);

  return { isCollapsed: (groupId: string) => ids.includes(groupId), toggleGroup };
}
