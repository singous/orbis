// The standalone home sidebar only repeats a workbench link and adds no useful navigation.
// Use the document overview and its complete navigation until the home experience is developed.
export const DEFAULT_WORKSPACE_PATH = "/documents";

/** Top-level ownership is shared by the rail, sidebar title and menu switch. */
export const WORKSPACE_AREAS = [
  { id: "home", label: "首页", title: "首页", href: "/home", roots: ["/home"], visibleInRail: false, navigationLabel: "首页导航" },
  { id: "documents", label: "在线文档", title: "在线文档", href: "/documents", roots: ["/documents", "/collections"], visibleInRail: true, navigationLabel: "文档导航" },
  { id: "sites", label: "站点", title: "站点发布", href: "/sites", roots: ["/sites"], visibleInRail: true, navigationLabel: "站点导航" },
  { id: "knowledge", label: "知识库", title: "知识库", href: "/knowledge", roots: ["/knowledge"], visibleInRail: true, navigationLabel: "知识库导航" },
  { id: "memory", label: "记忆", title: "记忆", href: "/memory", roots: ["/memory"], visibleInRail: true, navigationLabel: "记忆导航" },
  { id: "settings", label: "账号设置", title: "全部设置", href: "/settings/account", roots: ["/settings"], visibleInRail: false, navigationLabel: "设置导航" },
] as const;

export type WorkspaceArea = (typeof WORKSPACE_AREAS)[number];
export type WorkspaceAreaId = WorkspaceArea["id"];

const defaultWorkspaceArea = WORKSPACE_AREAS.find(area => area.href === DEFAULT_WORKSPACE_PATH)!;

export function resolveWorkspaceArea(pathname: string): WorkspaceArea {
  const effectivePath = pathname === "/home" ? DEFAULT_WORKSPACE_PATH : pathname;
  return WORKSPACE_AREAS.find((area) =>
    area.roots.some((root) => effectivePath === root || effectivePath.startsWith(`${root}/`)),
  ) ?? defaultWorkspaceArea;
}
