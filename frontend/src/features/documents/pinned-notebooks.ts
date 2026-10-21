import { useCallback, useSyncExternalStore } from "react";

const EMPTY_PINNED: string[] = [];
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
    try { window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(ids)); } catch { /* Retain the preference for this session when storage is unavailable. */ }
  }
  listeners.forEach((fn) => fn());
}

function syncStorage(event: StorageEvent) {
  for (const workspaceId of Object.keys(snapshotCache)) {
    if (event.key === null || event.key === storageKey(workspaceId)) delete snapshotCache[workspaceId];
  }
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  if (!listeners.size) window.addEventListener("storage", syncStorage);
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    if (!listeners.size) window.removeEventListener("storage", syncStorage);
  };
}

export function usePinnedNotebooks(workspaceId: string | undefined) {
  const key = workspaceId ?? "";
  const pinned = useSyncExternalStore(subscribe, () => getSnapshot(key), () => EMPTY_PINNED);

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
