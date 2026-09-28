import { ArrowLeft, Home } from "../../shared/ui/icons";
import { Link, NavLink } from "react-router-dom";

import { NotebookIcon } from "./NotebookIcon";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { useNotebooks } from "./queries";

export type NotebookSectionMenuProps = {
  notebookId: string;
  activeNoteId?: string;
};

/**
 * Left function column shown while working inside a notebook: notebook
 * identity on top, its document tree below. Mounted into the shell's
 * sectionMenu slot (rail | menu | content).
 */
export function NotebookSectionMenu({ notebookId, activeNoteId }: NotebookSectionMenuProps) {
  const notebooksQuery = useNotebooks();
  const notebook = notebooksQuery.data?.items.find((item) => item.id === notebookId);

  return (
    <nav className="workspace-function-menu" aria-label="笔记本目录">
      <div className="workspace-function-heading">
        <Link to="/documents" className="notebook-menu-back">
          <ArrowLeft aria-hidden="true" size={14} />
          文档中心
        </Link>
        <Link to={`/collections/${notebookId}`} className="notebook-menu-title flex items-center gap-2" title={notebook?.title}>
          <NotebookIcon icon={notebook?.icon} size="sm" /><span className="truncate">{notebook?.title ?? "正在加载…"}</span>
        </Link>
      </div>
      <NavLink end to={`/collections/${notebookId}`} aria-label="笔记本首页" className={({ isActive }) => `workspace-function-link notebook-home-link${isActive ? " is-active" : ""}`}><Home aria-hidden="true" size={16} /><span>首页</span></NavLink>
      <DocumentContextPanel notebookId={notebookId} activeNoteId={activeNoteId} />
    </nav>
  );
}
