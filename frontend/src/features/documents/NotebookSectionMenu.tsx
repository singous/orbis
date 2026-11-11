import { cn } from "@orbis/ui/cn";
import { workspaceFunctionMenuClassName, workspaceFunctionLinkClassName } from "../workspace/workspace-navigation-styles";
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
import { Button } from "@orbis/ui/button";
import type { WorkspaceSidebarConfig } from "../workspace/workspace-sidebar-config";
import { useStore } from "zustand";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { authStore } from "../../shared/auth/auth-store";
import { ArrowLeft, ChevronDown, FilePlus2, Home, MoreHorizontal, Pin, Plus, Settings2 } from "../../shared/ui/icons";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { NotebookIdentity } from "./NotebookIdentity";
import { NotebookShortcuts } from "./NotebookShortcuts";
import { EditNotebookDialog } from "./NotebookDialog";
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
    railActions: releaseFeatures.documentFavorites ? <NotebookShortcuts key={notebookId} notebookId={notebookId} /> : null,
    leadingActions: (
      <Link to="/documents" className="notebook-menu-back focus-ring m-0 flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground" aria-label="返回我的文档" title="返回我的文档">
        <ArrowLeft aria-hidden="true" size={14} className="shrink-0" /><span className="truncate">我的文档</span>
      </Link>
    ),
    actions: <NotebookCreateAction notebookId={notebookId} />,
    content: (
      <NotebookSectionMenu
        key={notebookId}
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
    <Link to={`/collections/${notebookId}`} className="notebook-menu-title focus-ring mt-1.5 flex min-h-(--ob-control-height-md) min-w-0 items-center gap-2 text-base font-semibold leading-6 tracking-[-.01em] text-foreground hover:text-primary [&>.notebook-icon]:shrink-0" title={notebook?.title}>
      <NotebookIdentity notebook={notebook} variant="sidebar" />
    </Link>
  );
}

export function NotebookCreateAction({ notebookId, placement = "sidebar" }: { notebookId: string; placement?: "sidebar" | "header" }) {
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
  const header = placement === "header";
  return canMutateWorkspaceContent(workspace) ? (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={creating} render={header ? <Button type="button" size="sm" className="h-[34px] gap-2 px-3" aria-label="新建内容"><Plus aria-hidden="true" />新建<ChevronDown aria-hidden="true" /></Button> : <Button type="button" className="notebook-menu-create shrink-0" aria-label="创建内容" title="创建内容" variant="ghost" size="icon-sm"><Plus aria-hidden="true" size={18} /></Button>} />
      <DropdownMenuContent align={header ? "end" : "start"} sideOffset={6} className="notebook-create-popover" aria-label="创建内容">
        <DropdownMenuItem label="随手记" onClick={() => navigate("/documents/quick-notes")}><StickyNote aria-hidden="true" size={16} className="notebook-create-quick-note text-(--ob-icon-mint)" /><span>随手记</span></DropdownMenuItem>
        <DropdownMenuItem label="文档" disabled={!tree.isSuccess} onClick={() => { void createDocument(); }}><FilePlus2 aria-hidden="true" size={16} className="notebook-create-document text-(--ob-icon-blue)" /><span>文档</span></DropdownMenuItem>
        {releaseFeatures.boardCreation && <DropdownMenuItem label="画板" disabled={!tree.isSuccess} onClick={() => { void createBoard(); }}><Shapes aria-hidden="true" size={16} className="notebook-create-board text-(--ob-icon-violet)" /><span>画板</span></DropdownMenuItem>}
        <DropdownMenuItem label="数据表" disabled={!tree.isSuccess} onClick={() => { void createTable(); }}><Table2 aria-hidden="true" size={16} className="notebook-create-table text-(--ob-icon-cyan)" /><span>数据表</span></DropdownMenuItem>
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
  const notebook = useNotebook(notebookId).data;
  const [editing, setEditing] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  return (
    <nav className={workspaceFunctionMenuClassName} aria-label="笔记本目录">
      <div className="notebook-home-row mb-3 flex items-center gap-1 rounded-md has-[[aria-current=page]]:bg-sidebar-accent">
        <NavLink
          end
          to={`/collections/${notebookId}`}
          aria-label="笔记本首页"
          className={({ isActive }) =>
            cn(workspaceFunctionLinkClassName({ isActive }), "notebook-home-link mt-0 flex-1")
          }
        >
          <Home aria-hidden="true" size={16} />
          <span>首页</span>
        </NavLink>
        {releaseFeatures.documentFavorites && <DropdownMenu>
          <DropdownMenuTrigger render={<Button  type="button" className="notebook-home-more shrink-0" aria-label="笔记本快捷操作" title="笔记本快捷操作" variant="ghost" size="icon-sm"><MoreHorizontal aria-hidden="true" size={18} /></Button>} />
          <DropdownMenuContent align="end" sideOffset={4} aria-label="笔记本快捷操作">
            <DropdownMenuItem label={isPinned(notebookId) ? "取消常用" : "设为常用"} onClick={() => togglePin(notebookId)}><Pin aria-hidden="true" size={16} /><span>{isPinned(notebookId) ? "取消常用" : "设为常用"}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <DocumentContextPanel notebookId={notebookId} activeNoteId={activeNoteId} />
      {canMutateWorkspaceContent(workspace) && notebook ? <div className="mt-auto pt-4">
        <Button ref={settingsButton} type="button" variant="ghost" className={workspaceFunctionLinkClassName()} onClick={() => setEditing(true)}><Settings2 aria-hidden="true" />笔记本设置</Button>
        {editing ? <EditNotebookDialog notebook={notebook} finalFocus={settingsButton} onClose={() => setEditing(false)} /> : null}
      </div> : null}
    </nav>
  );
}
