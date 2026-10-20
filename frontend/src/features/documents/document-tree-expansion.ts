import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { NoteTreeItem } from "../../shared/api/schemas";

const EMPTY_SNAPSHOT = "[]";
const listeners = new Map<string, Set<() => void>>();
const fallbackSnapshots = new Map<string, string>();

export function documentTreeStorageKey(workspaceId: string | undefined, notebookId: string, view: "side" | "main" = "side") {
  const base = `orbis.document-tree.collapsed.${workspaceId ?? "anonymous"}.${notebookId}`;
  return view === "main" ? `${base}.main` : base;
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

function collectBranchIds(items: NoteTreeItem[]): string[] {
  return items.flatMap(note => note.children.length ? [note.id, ...collectBranchIds(note.children)] : []);
}

/** Each notebook view keeps independent device preferences; legacy sidebar keys remain valid. */
export function useDocumentTreeExpansion(workspaceId: string | undefined, notebookId: string, items: NoteTreeItem[], activeNoteId?: string, view: "side" | "main" = "side") {
  const key = documentTreeStorageKey(workspaceId, notebookId, view);
  const snapshot = useSyncExternalStore(
    useCallback((notify) => subscribe(key, notify), [key]),
    useCallback(() => readSnapshot(key), [key]),
    () => EMPTY_SNAPSHOT,
  );
  const collapsed = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const collapsedIds = useMemo(() => new Set(collapsed), [collapsed]);
  const branchIds = useMemo(() => collectBranchIds(items), [items]);
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

  const expandAll = useCallback(() => writeCollapsed(key, []), [key]);
  const collapseAll = useCallback(() => writeCollapsed(key, branchIds), [key, branchIds]);
  const reveal = useCallback((noteId: string) => {
    const path = findAncestors(items, noteId);
    if (!path) return false;
    const ancestors = new Set(path);
    const current = parseSnapshot(readSnapshot(key));
    const next = current.filter(id => !ancestors.has(id));
    if (next.length !== current.length) writeCollapsed(key, next);
    return true;
  }, [items, key]);

  return {
    isExpanded: (noteId: string) => !collapsedIds.has(noteId), toggle,
    expandAll, collapseAll, reveal,
    hasBranches: branchIds.length > 0,
    allExpanded: branchIds.length > 0 && branchIds.every(id => !collapsedIds.has(id)),
  };
}
