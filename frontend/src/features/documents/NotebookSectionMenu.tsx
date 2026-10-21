import type { WorkspaceSidebarConfig } from "../workspace/workspace-sidebar-config";
import { useStore } from "zustand";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";
import { showToast } from "../../shared/ui/Toast";
import { ArrowLeft, Home, Pin, Plus } from "../../shared/ui/icons";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { NotebookIcon } from "./NotebookIcon";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { useCreateNote, useNotebook, useNoteTree } from "./queries";

export type NotebookSectionMenuProps = { notebookId: string; activeNoteId?: string };

const NOTEBOOK_SIDEBAR_PREFERENCES = {
  widthKey: "orbis.notebookDirectoryWidth",
};

/** Notebook-specific slots contain no layout or collapse state. */
export function createNotebookSidebar(notebookId: string, activeNoteId?: string): WorkspaceSidebarConfig {
  return {
    id: "notebook-directory",
    title: <NotebookSidebarTitle notebookId={notebookId} />,
    actions: <NotebookCreateAction notebookId={notebookId} />,
    content: <NotebookSectionMenu notebookId={notebookId} activeNoteId={activeNoteId} />,
    label: "笔记本目录栏",
    collapseLabel: "收起笔记本目录",
    expandLabel: "展开笔记本目录",
    resizeLabel: "调整笔记本目录宽度",
    preferences: NOTEBOOK_SIDEBAR_PREFERENCES,
  };
}

function NotebookSidebarTitle({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId).data;
  return <div className="notebook-menu-header">
    <Link to="/documents" className="notebook-menu-back" aria-label="返回文档中心" title="返回文档中心"><ArrowLeft aria-hidden="true" size={16} /></Link>
    <Link to={`/collections/${notebookId}`} className="notebook-menu-title" title={notebook?.title}>
      <NotebookIcon icon={notebook?.icon} size="sm" /><span className="truncate">{notebook?.title ?? "正在加载…"}</span>
    </Link>
  </div>;
}

function NotebookCreateAction({ notebookId }: { notebookId: string }) {
  const workspace = useStore(authStore, state => state.workspace);
  const createNote = useCreateNote();
  const tree = useNoteTree(notebookId);
  const navigate = useNavigate();

  async function createDocument() {
    try {
      const note = await createNote.mutateAsync({ notebook_id: notebookId, title: "未命名文档", parent_id: null, sort_order: tree.data?.items.length ?? 0 });
      navigate(`/documents/${note.id}`);
    } catch (error) {
      showToast({ title: "创建文档失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" });
    }
  }

  return canMutateWorkspaceContent(workspace) ? <ActionButton type="button" className="notebook-menu-create" aria-label="新建文档" title="新建文档" disabled={createNote.isPending || !tree.isSuccess} onClick={() => void createDocument()}><Plus aria-hidden="true" size={18} /></ActionButton> : null;
}

/** The side tree retains its own expansion preferences independently of the page. */
export function NotebookSectionMenu({ notebookId, activeNoteId }: NotebookSectionMenuProps) {
  const workspace = useStore(authStore, state => state.workspace);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  return <nav className="workspace-function-menu" aria-label="笔记本目录">
    <div className="notebook-menu-actions">
      <ActionButton type="button" aria-label={isPinned(notebookId) ? "移出快捷访问" : "加入快捷访问"} aria-pressed={isPinned(notebookId)} onClick={() => togglePin(notebookId)}><Pin size={15} />{isPinned(notebookId) ? "已加入快捷访问" : "加入快捷访问"}</ActionButton>
    </div>
    <NavLink end to={`/collections/${notebookId}`} aria-label="笔记本首页" className={({ isActive }) => `workspace-function-link notebook-home-link${isActive ? " is-active" : ""}`}><Home aria-hidden="true" size={16} /><span>首页</span></NavLink>
    <DocumentContextPanel notebookId={notebookId} activeNoteId={activeNoteId} />
  </nav>;
}
