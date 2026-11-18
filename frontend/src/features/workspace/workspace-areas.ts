import { matchPath } from "react-router-dom";
export const DEFAULT_WORKSPACE_PATH = "/home";

/** Route ownership also supplies the loading title and the secondary menu title. */
const WORKSPACE_AREAS = [
  { id: "search", title: "全局搜索", sidebarTitle: "文档", roots: ["/search"] },
  { id: "home", title: "首页", sidebarTitle: "文档", roots: [DEFAULT_WORKSPACE_PATH] },
  { id: "documents", title: "在线文档", sidebarTitle: "文档", roots: ["/documents", "/collections", "/sheets"] },
  { id: "sites", title: "站点发布", sidebarTitle: "站点发布", roots: ["/sites"] },
  { id: "settings", title: "全部设置", sidebarTitle: "全部设置", roots: ["/settings"] },
] as const;

type WorkspaceArea = (typeof WORKSPACE_AREAS)[number];

const defaultWorkspaceArea = WORKSPACE_AREAS.find(area => area.id === "home")!;

export function resolveWorkspaceArea(pathname: string): WorkspaceArea {
  return WORKSPACE_AREAS.find((area) =>
    area.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`)),
  ) ?? defaultWorkspaceArea;
}

export function usesDocumentPageLayout(pathname: string) {
  return Boolean(matchPath("/documents", pathname) || matchPath("/documents/recent", pathname) || matchPath("/collections/:collectionId", pathname));
}
