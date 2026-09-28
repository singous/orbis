// Home is an overview; only task-oriented areas need a function sidebar.
export const DEFAULT_WORKSPACE_PATH = "/home";

/** Top-level ownership is shared by the rail, sidebar title and menu switch. */
export const WORKSPACE_AREAS = [
  { id: "home", label: "首页", title: "首页", href: "/home", roots: ["/home"], showFunctionSidebar: false, visibleInRail: true, navigationLabel: "首页导航" },
  { id: "documents", label: "在线文档", title: "在线文档", href: "/documents", roots: ["/documents", "/collections"], showFunctionSidebar: true, visibleInRail: true, navigationLabel: "文档导航" },
  { id: "sites", label: "站点", title: "站点发布", href: "/sites", roots: ["/sites"], showFunctionSidebar: true, visibleInRail: true, navigationLabel: "站点导航" },
  { id: "knowledge", label: "知识库", title: "知识库", href: "/knowledge", roots: ["/knowledge"], showFunctionSidebar: true, visibleInRail: true, navigationLabel: "知识库导航" },
  { id: "memory", label: "记忆", title: "记忆", href: "/memory", roots: ["/memory"], showFunctionSidebar: true, visibleInRail: true, navigationLabel: "记忆导航" },
  { id: "settings", label: "账号设置", title: "全部设置", href: "/settings/account", roots: ["/settings"], showFunctionSidebar: true, visibleInRail: false, navigationLabel: "设置导航" },
] as const;

export type WorkspaceArea = (typeof WORKSPACE_AREAS)[number];
export type WorkspaceAreaId = WorkspaceArea["id"];

const defaultWorkspaceArea = WORKSPACE_AREAS.find(area => area.href === DEFAULT_WORKSPACE_PATH)!;

export function resolveWorkspaceArea(pathname: string): WorkspaceArea {
  return WORKSPACE_AREAS.find((area) =>
    area.roots.some((root) => pathname === root || pathname.startsWith(`${root}/`)),
  ) ?? defaultWorkspaceArea;
}
