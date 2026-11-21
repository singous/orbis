import { Link } from "react-router-dom";
import { ArrowLeft } from "../../shared/ui/icons";
import type { WorkspaceSidebarConfig } from "../workspace/workspace-sidebar-config";

export const notebookSidebarLayout = {
  id: "notebook-directory",
  titlePlacement: "below-header",
  label: "笔记本目录栏",
  collapseLabel: "收起笔记本目录",
  expandLabel: "展开笔记本目录",
  resizeLabel: "调整笔记本目录宽度",
  preferences: { widthKey: "orbis.notebookDirectoryWidth" },
} satisfies Partial<WorkspaceSidebarConfig>;

export function NotebookSidebarBackLink() {
  return <Link to="/documents" className="notebook-menu-back focus-ring m-0 flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground" aria-label="返回我的文档" title="返回我的文档">
    <ArrowLeft aria-hidden="true" size={14} className="shrink-0" /><span className="truncate">我的文档</span>
  </Link>;
}
