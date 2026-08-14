import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const snapshotCache: Record<string, string[]> = {};

function storageKey(workspaceId: string): string {
  return `orbis.pinnedNotebooks.${workspaceId}`;
}

function readFromStorage(workspaceId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function getSnapshot(workspaceId: string): string[] {
  if (!(workspaceId in snapshotCache)) {
    snapshotCache[workspaceId] = readFromStorage(workspaceId);
  }
  return snapshotCache[workspaceId];
}

function writePinned(workspaceId: string, ids: string[]) {
  snapshotCache[workspaceId] = ids;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(ids));
  }
  listeners.forEach((fn) => fn());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function usePinnedNotebooks(workspaceId: string | undefined) {
  const key = workspaceId ?? "";
  const pinned = useSyncExternalStore(subscribe, () => getSnapshot(key), () => []);

  const isPinned = useCallback((notebookId: string) => pinned.includes(notebookId), [pinned]);

  const togglePin = useCallback(
    (notebookId: string) => {
      if (!workspaceId) return;
      const current = getSnapshot(workspaceId);
      const next = current.includes(notebookId)
        ? current.filter((id) => id !== notebookId)
        : [...current, notebookId];
      writePinned(workspaceId, next);
    },
    [workspaceId],
  );

  return { pinned, isPinned, togglePin };
}
