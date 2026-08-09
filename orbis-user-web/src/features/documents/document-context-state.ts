const STORAGE_PREFIX = "orbis.document-context.open.";

export function documentContextStorageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

export function readDocumentContextOpen(workspaceId: string): boolean {
  if (typeof window === "undefined") return true;

  const value = window.localStorage.getItem(documentContextStorageKey(workspaceId));
  return value === "false" ? false : true;
}

export function writeDocumentContextOpen(workspaceId: string, open: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(documentContextStorageKey(workspaceId), String(open));
}
