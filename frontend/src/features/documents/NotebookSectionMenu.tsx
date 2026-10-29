import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { sheetAPI } from "../sheets/api";
import { boardAPI } from "../boards/api";
import { Shapes, StickyNote, Table2 } from "lucide-react";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import type { WorkspaceSidebarConfig } from "../workspace/workspace-sidebar-config";
import { useStore } from "zustand";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { authStore } from "../../shared/auth/auth-store";
import { ActionButton } from "../../shared/ui/ActionButton";
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
    <Dropdown>
      <ActionButton type="button" className="notebook-menu-create" aria-label="创建内容" title="创建内容" disabled={creating}><Plus aria-hidden="true" size={18} /></ActionButton>
      <Dropdown.Popover placement="bottom start" offset={6} className="notebook-create-popover">
        <Dropdown.Menu aria-label="创建内容" onAction={key => {
          if (key === "quick-note") navigate("/documents/quick-notes");
          if (key === "document") void createDocument();
          if (key === "board") void createBoard();
          if (key === "table") void createTable();
        }}>
          <Dropdown.Item id="quick-note" textValue="随手记"><StickyNote aria-hidden="true" className="notebook-create-quick-note" /><Label>随手记</Label></Dropdown.Item>
          <Dropdown.Item id="document" textValue="文档" isDisabled={!tree.isSuccess}><FilePlus2 aria-hidden="true" className="notebook-create-document" /><Label>文档</Label></Dropdown.Item>
          {releaseFeatures.boardCreation && <Dropdown.Item id="board" textValue="画板" isDisabled={!tree.isSuccess}><Shapes aria-hidden="true" className="notebook-create-board" /><Label>画板</Label></Dropdown.Item>}
          <Dropdown.Item id="table" textValue="数据表" isDisabled={!tree.isSuccess}><Table2 aria-hidden="true" className="notebook-create-table" /><Label>数据表</Label></Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
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
        {releaseFeatures.documentFavorites && <Dropdown>
          <ActionButton type="button" className="notebook-home-more" aria-label="笔记本快捷操作" title="笔记本快捷操作"><MoreHorizontal aria-hidden="true" size={18} /></ActionButton>
          <Dropdown.Popover placement="bottom end" offset={4}>
            <Dropdown.Menu aria-label="笔记本快捷操作" onAction={() => togglePin(notebookId)}>
              <Dropdown.Item id="pin" textValue={isPinned(notebookId) ? "移出快捷访问" : "加入快捷访问"}><Pin aria-hidden="true" size={16} /><Label>{isPinned(notebookId) ? "移出快捷访问" : "加入快捷访问"}</Label></Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>}
      </div>
      <DocumentContextPanel
        notebookId={notebookId}
        activeNoteId={activeNoteId}
      />
    </nav>
  );
}
