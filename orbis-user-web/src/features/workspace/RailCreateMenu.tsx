import { Dropdown } from "@heroui/react/dropdown";
import { Header } from "@heroui/react/header";
import { Label } from "@heroui/react/label";
import { BookOpen, FilePlus2, Plus } from "../../shared/ui/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionButton } from "../../shared/ui/ActionButton";

import { useToast } from "../../shared/ui/Toast";
import { NotebookDialog } from "../documents/NotebookDialog";
import type { NotebookIconValue } from "../documents/notebook-icons";
import {
  useCreateNote,
  useCreateNotebook,
  useDocumentGroups,
  useNoteTree,
  useNotebooks,
} from "../documents/queries";

/**
 * Keyboard-accessible quick-create menu for the document area.
 * Documents are captured straight into the most recently updated notebook.
 */
export function RailCreateMenu() {
  const navigate = useNavigate();
  const { toast } = useToast();
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

  async function submitNotebook({ title, icon }: { title: string; icon: NotebookIconValue | null }) {
    const groups = groupsQuery.data?.items ?? [];
    const group = groups.find((item) => item.is_default) ?? groups[0];
    if (!group) return;
    const notebook = await createNotebook.mutateAsync({
      title,
      icon,
      group_id: group.id,
      sort_order: notebooks.length,
    });
    setNotebookDialogOpen(false);
    navigate(`/collections/${notebook.id}`);
  }

  return (
    <>
      <Dropdown onOpenChange={setArmed}>
        <ActionButton type="button" className="rail-create-trigger" aria-label="新建资产"><Plus size={18} aria-hidden="true" /></ActionButton>
        <Dropdown.Popover className="rail-create-popover" placement="bottom start" offset={10}>
          <Dropdown.Menu aria-label="在当前空间新建" onAction={(key) => {
            if (key === "document") void createDocument().catch(() => toast({ title: "文档创建失败，请重试", tone: "danger" }));
            if (key === "notebook") setNotebookDialogOpen(true);
          }}>
            <Dropdown.Section>
              <Header>在当前空间新建</Header>
              <Dropdown.Item id="document" textValue="文档" isDisabled={createNote.isPending}><FilePlus2 aria-hidden="true" /><Label>文档</Label></Dropdown.Item>
              <Dropdown.Item id="notebook" textValue="笔记本"><BookOpen aria-hidden="true" /><Label>笔记本</Label></Dropdown.Item>
            </Dropdown.Section>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <NotebookDialog
        open={notebookDialogOpen}
        title="新建笔记本"
        submitLabel="创建笔记本"
        pending={createNotebook.isPending}
        onClose={() => setNotebookDialogOpen(false)}
        onSubmit={submitNotebook}
      />
    </>
  );
}
