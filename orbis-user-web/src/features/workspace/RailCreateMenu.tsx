import { BookOpen, FilePlus2, LibraryBig, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ResourceDialog } from "../documents/ResourceDialog";
import {
  useCreateNote,
  useCreateNotebook,
  useDocumentGroups,
  useNoteTree,
  useNotebooks,
} from "../documents/queries";

/**
 * Quick-create entry on the business rail. Hover reveals the creatable
 * asset types: 文档 / 笔记本 now, 知识库 / 记忆库 once those modules land.
 * Documents are captured straight into the most recently updated notebook.
 */
export function RailCreateMenu() {
  const navigate = useNavigate();
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const createNote = useCreateNote();
  const createNotebook = useCreateNotebook();
  const [armed, setArmed] = useState(false);
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false);

  const notebooks = notebooksQuery.data?.items ?? [];
  const targetNotebook = [...notebooks].sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0];
  const treeQuery = useNoteTree(armed ? targetNotebook?.id : undefined);

  async function createDocument() {
    if (!targetNotebook) {
      navigate("/documents/collections");
      return;
    }
    const note = await createNote.mutateAsync({
      notebook_id: targetNotebook.id,
      title: "未命名文档",
      parent_id: null,
      sort_order: treeQuery.data?.items.length ?? 0,
    });
    navigate(`/documents/${note.id}`);
  }

  async function submitNotebook(title: string) {
    const groups = groupsQuery.data?.items ?? [];
    const group = groups.find((item) => item.is_default) ?? groups[0];
    if (!group) return;
    const notebook = await createNotebook.mutateAsync({
      title,
      group_id: group.id,
      sort_order: notebooks.length,
    });
    setNotebookDialogOpen(false);
    navigate(`/collections/${notebook.id}`);
  }

  return (
    <>
      <div className="rail-create-group" onMouseEnter={() => setArmed(true)}>
        <button type="button" className="rail-tile" aria-label="新建资产">
          <span className="rail-tile-icon">
            <Plus aria-hidden="true" size={21} strokeWidth={2.1} />
          </span>
          <span className="rail-tile-label">新建</span>
        </button>
        <div className="rail-create-popover">
          <button type="button" className="rail-create-item" onClick={() => void createDocument()} disabled={createNote.isPending}>
            <FilePlus2 aria-hidden="true" size={14} />
            文档
          </button>
          <button type="button" className="rail-create-item" onClick={() => setNotebookDialogOpen(true)}>
            <BookOpen aria-hidden="true" size={14} />
            笔记本
          </button>
          <button type="button" className="rail-create-item" disabled>
            <LibraryBig aria-hidden="true" size={14} />
            知识库
            <span className="rail-create-soon">即将推出</span>
          </button>
          <button type="button" className="rail-create-item" disabled>
            <Sparkles aria-hidden="true" size={14} />
            记忆库
            <span className="rail-create-soon">即将推出</span>
          </button>
        </div>
      </div>
      <ResourceDialog
        open={notebookDialogOpen}
        title="新建笔记本"
        label="笔记本名称"
        placeholder="例如：Orbis 产品手册"
        submitLabel="创建笔记本"
        pending={createNotebook.isPending}
        onClose={() => setNotebookDialogOpen(false)}
        onSubmit={submitNotebook}
      />
    </>
  );
}
