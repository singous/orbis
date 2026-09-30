import { useStore } from "zustand";
import { useNavigate } from "react-router-dom";
import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";
import { showToast } from "../../shared/ui/Toast";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { ArrowLeft, Home, Pin, Plus } from "../../shared/ui/icons";
import { Link, NavLink } from "react-router-dom";

import { NotebookIcon } from "./NotebookIcon";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { useCreateNote, useNotebooks, useNoteTree } from "./queries";

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
  const workspace = useStore(authStore, (state) => state.workspace);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const createNote = useCreateNote();
  const tree = useNoteTree(notebookId);
  const navigate = useNavigate();
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
      <div className="notebook-menu-actions">
        <ActionButton type="button" aria-label={isPinned(notebookId) ? "移出快捷访问" : "加入快捷访问"} aria-pressed={isPinned(notebookId)} onClick={() => togglePin(notebookId)}><Pin size={15} />{isPinned(notebookId) ? "已加入快捷访问" : "加入快捷访问"}</ActionButton>
        {canMutateWorkspaceContent(workspace) ? <ActionButton type="button" aria-label="新建文档" disabled={createNote.isPending || !tree.isSuccess} onClick={() => void createNote.mutateAsync({ notebook_id: notebookId, title: "未命名文档", parent_id: null, sort_order: tree.data?.items.length ?? 0 }).then((note) => navigate(`/documents/${note.id}`)).catch((error) => showToast({ title: "创建文档失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }))}><Plus size={18} /></ActionButton> : null}
      </div>
      <NavLink end to={`/collections/${notebookId}`} aria-label="笔记本首页" className={({ isActive }) => `workspace-function-link notebook-home-link${isActive ? " is-active" : ""}`}><Home aria-hidden="true" size={16} /><span>首页</span></NavLink>
      <DocumentContextPanel notebookId={notebookId} activeNoteId={activeNoteId} />
    </nav>
  );
}
