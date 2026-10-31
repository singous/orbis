const STORAGE_PREFIX = "orbis.document-context.open.";

export function documentContextStorageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

export function readDocumentContextOpen(workspaceId: string): boolean {
  if (typeof window === "undefined") return true;

  try {
    const value = window.localStorage.getItem(documentContextStorageKey(workspaceId));
    return value !== "false";
  } catch {
    // 可选的面板偏好不能阻断文档加载。
    return true;
  }
}

export function writeDocumentContextOpen(workspaceId: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(documentContextStorageKey(workspaceId), String(open));
  } catch {
    // 浏览器拒绝存储时，DocumentShell 仍保留本次会话的开关状态。
  }
}
