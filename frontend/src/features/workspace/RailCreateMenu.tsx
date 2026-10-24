import { BookOpen, FilePlus2, Plus } from "../../shared/ui/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";

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

/** The global trigger mounts document queries only while a creation flow is open. */
export function RailCreateMenu() {
  const [open, setOpen] = useState(false);
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false);
  return <>
    <ActionButton type="button" className="rail-create-trigger" aria-label="新建资产" aria-haspopup="dialog" aria-expanded={open || notebookDialogOpen} onClick={() => setOpen(true)}><Plus size={18} aria-hidden="true" /></ActionButton>
    {open || notebookDialogOpen ? <RailCreateActions open={open} onOpenChange={setOpen} notebookDialogOpen={notebookDialogOpen} onNotebookDialogChange={setNotebookDialogOpen} /> : null}
  </>;
}

function RailCreateActions({ open, onOpenChange, notebookDialogOpen, onNotebookDialogChange }: { open: boolean; onOpenChange: (open: boolean) => void; notebookDialogOpen: boolean; onNotebookDialogChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const createNote = useCreateNote();
  const createNotebook = useCreateNotebook();

  const notebooks = notebooksQuery.data?.items ?? [];
  const targetNotebook = [...notebooks].sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0];
  const treeQuery = useNoteTree(open ? targetNotebook?.id : undefined);

  async function createDocument() {
    if (!targetNotebook) {
      onOpenChange(false);
      navigate("/documents/collections");
      return;
    }
    const note = await createNote.mutateAsync({
      notebook_id: targetNotebook.id,
      title: "未命名文档",
      parent_id: null,
      sort_order: treeQuery.data?.items.length ?? 0,
    });
    onOpenChange(false);
    navigate(`/documents/${note.id}`);
  }

  async function submitNotebook({ title, icon }: { title: string; icon: NotebookIconValue | null }) {
    const groups = groupsQuery.data?.items ?? [];
    const group = groups.find((item) => item.is_default) ?? groups[0];
    if (!group) throw new Error("无法读取笔记本分组，请稍后重试。");
    const notebook = await createNotebook.mutateAsync({
      title,
      icon,
      group_id: group.id,
      sort_order: notebooks.length,
    });
    onNotebookDialogChange(false);
    navigate(`/collections/${notebook.id}`);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!createNote.isPending) onOpenChange(next); }}>
        <DialogContent title="新建资产" description="选择要创建的内容。">
          <div className="grid gap-3">
            <Button icon={<FilePlus2 aria-hidden="true" size={18} />} isPending={createNote.isPending} disabled={notebooksQuery.isLoading || notebooksQuery.isError || Boolean(targetNotebook && !treeQuery.isSuccess)} onClick={() => void createDocument().catch(error => toast({ title: "文档创建失败，请重试", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }))}>文档</Button>
            <Button icon={<BookOpen aria-hidden="true" size={18} />} onClick={() => { onNotebookDialogChange(true); onOpenChange(false); }}>笔记本</Button>
          </div>
        </DialogContent>
      </Dialog>
      <NotebookDialog
        open={notebookDialogOpen}
        title="新建笔记本"
        submitLabel="创建笔记本"
        pending={createNotebook.isPending || groupsQuery.isLoading || notebooksQuery.isLoading}
        onClose={() => { onNotebookDialogChange(false); onOpenChange(true); }}
        onSubmit={submitNotebook}
      />
    </>
  );
}
