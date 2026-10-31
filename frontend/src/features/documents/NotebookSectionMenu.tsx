import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { sheetAPI } from "../sheets/api";
import { boardAPI } from "../boards/api";
import { Shapes, StickyNote, Table2 } from "@orbis/ui/icons";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@orbis/ui/dropdown-menu";
import { Button as MenuButton } from "@orbis/ui/button";
import type { WorkspaceSidebarConfig } from "../workspace/workspace-sidebar-config";
import { useStore } from "zustand";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { authStore } from "../../shared/auth/auth-store";
import { ArrowLeft, FilePlus2, Home, MoreHorizontal, Pin, Plus } from "../../shared/ui/icons";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { NotebookIcon } from "./NotebookIcon";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { useCreateNote, useNotebook, useNoteTree } from "./queries";

export type NotebookSectionMenuProps = {
  notebookId: string;
  activeNoteId?: string;
};

const NOTEBOOK_SIDEBAR_PREFERENCES = {
  widthKey: "orbis.notebookDirectoryWidth",
};

/** Notebook-specific slots contain no layout or collapse state. */
export function createNotebookSidebar(
  notebookId: string,
  activeNoteId?: string,
): WorkspaceSidebarConfig {
  return {
    id: "notebook-directory",
    title: <NotebookSidebarTitle notebookId={notebookId} />,
    titlePlacement: "below-header",
    leadingActions: (
      <Link to="/documents" className="notebook-menu-back" aria-label="返回文档中心" title="返回文档中心">
        <ArrowLeft aria-hidden="true" size={18} />
      </Link>
    ),
    actions: <NotebookCreateAction notebookId={notebookId} />,
    content: (
      <NotebookSectionMenu
        notebookId={notebookId}
        activeNoteId={activeNoteId}
      />
    ),
    label: "笔记本目录栏",
    collapseLabel: "收起笔记本目录",
    expandLabel: "展开笔记本目录",
    resizeLabel: "调整笔记本目录宽度",
    preferences: NOTEBOOK_SIDEBAR_PREFERENCES,
  };
}

function NotebookSidebarTitle({ notebookId }: { notebookId: string }) {
  const notebook = useNotebook(notebookId).data;
  return (
    <Link to={`/collections/${notebookId}`} className="notebook-menu-title" title={notebook?.title}>
      <NotebookIcon icon={notebook?.icon} size="sm" />
      <span className="truncate">{notebook?.title ?? "正在加载…"}</span>
    </Link>
  );
}

function NotebookCreateAction({ notebookId }: { notebookId: string }) {
  const workspace = useStore(authStore, (state) => state.workspace);
  const createNote = useCreateNote();
  const tree = useNoteTree(notebookId);
  const navigate = useNavigate();
  const auth = useAuthRequest();
  const client = useQueryClient();
  const [creatingTable, setCreatingTable] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const boardIntent = useRef<{ id: string; operation_id: string; page_id: string } | null>(null);
  const tableIntent = useRef<string | null>(null);

  async function createBoard() {
    if (!releaseFeatures.boardCreation || creatingBoard) return;
    setCreatingBoard(true);
    boardIntent.current ??= { id: newUUID(), operation_id: newUUID(), page_id: newUUID() };
    try {
      const board = await boardAPI(auth).create({ ...boardIntent.current, collection_id: notebookId, parent_id: null, title: "未命名画板", elements: [] });
      boardIntent.current = null;
      await client.invalidateQueries({ queryKey: ["note-tree", notebookId] });
      await client.invalidateQueries({ queryKey: ["notebooks"] });
      navigate(`/documents/${board.document_id}`);
    } catch (error) {
      reportError(error);
    } finally {
      setCreatingBoard(false);
    }
  }
  async function createTable() {
    if (creatingTable) return;
    setCreatingTable(true);
    tableIntent.current ??= newUUID();
    try {
      const table = await sheetAPI(auth).create({
        id: tableIntent.current,
        collection_id: notebookId,
        title: "未命名数据表",
        template: "",
      });
      tableIntent.current = null;
      await client.invalidateQueries({ queryKey: ["note-tree", notebookId] });
      await client.invalidateQueries({ queryKey: ["notebooks"] });
      navigate(`/documents/${table.document_id}`);
    } catch (error) {
      reportError(error);
    } finally {
      setCreatingTable(false);
    }
  }

  async function createDocument() {
    try {
      const note = await createNote.mutateAsync({
        notebook_id: notebookId,
        title: "未命名文档",
        parent_id: null,
        sort_order: tree.data?.items.length ?? 0,
      });
      navigate(`/documents/${note.id}`);
    } catch (error) {
      reportError(error);
    }
  }

  const creating = createNote.isPending || creatingTable || creatingBoard;
  return canMutateWorkspaceContent(workspace) ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={creating}><MenuButton appearance="unstyled" type="button" className="notebook-menu-create" aria-label="创建内容" title="创建内容"><Plus aria-hidden="true" size={18} /></MenuButton></DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="notebook-create-popover" aria-label="创建内容">
        <DropdownMenuItem textValue="随手记" onSelect={() => navigate("/documents/quick-notes")}><StickyNote aria-hidden="true" size={16} className="notebook-create-quick-note" /><span>随手记</span></DropdownMenuItem>
        <DropdownMenuItem textValue="文档" disabled={!tree.isSuccess} onSelect={() => { void createDocument(); }}><FilePlus2 aria-hidden="true" size={16} className="notebook-create-document" /><span>文档</span></DropdownMenuItem>
        {releaseFeatures.boardCreation && <DropdownMenuItem textValue="画板" disabled={!tree.isSuccess} onSelect={() => { void createBoard(); }}><Shapes aria-hidden="true" size={16} className="notebook-create-board" /><span>画板</span></DropdownMenuItem>}
        <DropdownMenuItem textValue="数据表" disabled={!tree.isSuccess} onSelect={() => { void createTable(); }}><Table2 aria-hidden="true" size={16} className="notebook-create-table" /><span>数据表</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;
}

/** The side tree retains its own expansion preferences independently of the page. */
export function NotebookSectionMenu({
  notebookId,
  activeNoteId,
}: NotebookSectionMenuProps) {
  const workspace = useStore(authStore, (state) => state.workspace);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  return (
    <nav className="workspace-function-menu" aria-label="笔记本目录">
      <div className="notebook-home-row">
        <NavLink
          end
          to={`/collections/${notebookId}`}
          aria-label="笔记本首页"
          className={({ isActive }) =>
            `workspace-function-link notebook-home-link${isActive ? " is-active" : ""}`
          }
        >
          <Home aria-hidden="true" size={16} />
          <span>首页</span>
        </NavLink>
        {releaseFeatures.documentFavorites && <DropdownMenu>
          <DropdownMenuTrigger asChild><MenuButton appearance="unstyled" type="button" className="notebook-home-more" aria-label="笔记本快捷操作" title="笔记本快捷操作"><MoreHorizontal aria-hidden="true" size={18} /></MenuButton></DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} aria-label="笔记本快捷操作">
            <DropdownMenuItem textValue={isPinned(notebookId) ? "取消常用" : "设为常用"} onSelect={() => togglePin(notebookId)}><Pin aria-hidden="true" size={16} /><span>{isPinned(notebookId) ? "取消常用" : "设为常用"}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <DocumentContextPanel
        notebookId={notebookId}
        activeNoteId={activeNoteId}
      />
    </nav>
  );
}
