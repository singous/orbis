import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { NoteTreeItem } from "../../shared/api/schemas";

const EMPTY_SNAPSHOT = "[]";
const listeners = new Map<string, Set<() => void>>();
const fallbackSnapshots = new Map<string, string>();

export function documentTreeStorageKey(workspaceId: string | undefined, notebookId: string) {
  return `orbis.document-tree.collapsed.${workspaceId ?? "anonymous"}.${notebookId}`;
}

function readSnapshot(key: string): string {
  if (fallbackSnapshots.has(key)) return fallbackSnapshots.get(key)!;
  try { return localStorage.getItem(key) ?? EMPTY_SNAPSHOT; }
  catch { return EMPTY_SNAPSHOT; }
}

function parseSnapshot(snapshot: string): string[] {
  try {
    const value: unknown = JSON.parse(snapshot);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

function writeCollapsed(key: string, ids: string[]) {
  const snapshot = JSON.stringify(ids);
  fallbackSnapshots.set(key, snapshot);
  try { localStorage.setItem(key, snapshot); fallbackSnapshots.delete(key); }
  catch { /* Keep the current tab usable when storage is unavailable. */ }
  listeners.get(key)?.forEach((notify) => notify());
}

function subscribe(key: string, notify: () => void) {
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(notify);
  listeners.set(key, subscribers);
  function sync(event: StorageEvent) {
    if (event.key !== key && event.key !== null) return;
    fallbackSnapshots.delete(key);
    notify();
  }
  window.addEventListener("storage", sync);
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) listeners.delete(key);
    window.removeEventListener("storage", sync);
  };
}

function findAncestors(items: NoteTreeItem[], noteId: string): string[] | undefined {
  for (const note of items) {
    if (note.id === noteId) return [];
    const path = findAncestors(note.children, noteId);
    if (path) return [note.id, ...path];
  }
  return undefined;
}

/** Both notebook views share device preferences scoped to workspace and notebook. */
export function useDocumentTreeExpansion(workspaceId: string | undefined, notebookId: string, items: NoteTreeItem[], activeNoteId?: string) {
  const key = documentTreeStorageKey(workspaceId, notebookId);
  const snapshot = useSyncExternalStore(
    useCallback((notify) => subscribe(key, notify), [key]),
    useCallback(() => readSnapshot(key), [key]),
    () => EMPTY_SNAPSHOT,
  );
  const collapsed = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const ancestorPath = activeNoteId ? findAncestors(items, activeNoteId)?.join(",") ?? "" : "";

  useEffect(() => {
    if (!ancestorPath) return;
    const ancestors = new Set(ancestorPath.split(","));
    const current = parseSnapshot(readSnapshot(key));
    const next = current.filter((id) => !ancestors.has(id));
    if (next.length !== current.length) writeCollapsed(key, next);
  }, [activeNoteId, ancestorPath, key]);

  const toggle = useCallback((noteId: string) => {
    const current = parseSnapshot(readSnapshot(key));
    writeCollapsed(key, current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]);
  }, [key]);

  return { isExpanded: (noteId: string) => !collapsed.includes(noteId), toggle };
}
