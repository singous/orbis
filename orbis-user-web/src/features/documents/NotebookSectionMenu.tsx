import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

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
          <ArrowLeft aria-hidden="true" size={13} />
          文档中心
        </Link>
        <div className="notebook-menu-title truncate" title={notebook?.title}>
          {notebook?.title ?? "正在加载…"}
        </div>
      </div>
      <DocumentContextPanel notebookId={notebookId} activeNoteId={activeNoteId} />
    </nav>
  );
}
