import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { Button } from "../../shared/ui/Button";
import { ActionButton } from "../../shared/ui/ActionButton";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";

import { Pin, Plus, BookOpen } from "../../shared/ui/icons";
import type { Notebook } from "../../shared/api/schemas";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { DocumentShell } from "./DocumentShell";
import { NotebookDialog } from "./NotebookDialog";
import { NotebookIcon } from "./NotebookIcon";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useCollapsedGroups } from "./collapsed-groups";
import { useCreateNotebook, useDocumentGroups, useNotebooks, useDocumentIndex } from "./queries";

export function DocumentOverviewPage() {
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const groupsQuery = useDocumentGroups();
  const notebooksQuery = useNotebooks();
  const notesQuery = useDocumentIndex("active", { allPages: true });
  const createNotebook = useCreateNotebook();
  const [creating, setCreating] = useState(false);
  const { isPinned, togglePin } = usePinnedNotebooks(workspace?.id);
  const { isCollapsed, toggleGroup } = useCollapsedGroups(workspace?.id);
  const notebooks = notebooksQuery.data?.items ?? [];
  const groups = groupsQuery.data?.items ?? [];
  const common = notebooks.filter((notebook) => isPinned(notebook.id));
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const note of notesQuery.data?.items ?? []) result.set(note.notebook_id, (result.get(note.notebook_id) ?? 0) + 1);
    return result;
  }, [notesQuery.data]);
  const grouped = groups.map((group) => ({ id: group.id, title: group.name, notebooks: notebooks.filter((notebook) => notebook.group_id === group.id) })).filter((group) => group.notebooks.length > 0);
  const knownGroups = new Set(groups.map((group) => group.id));
  const ungrouped = notebooks.filter((notebook) => !knownGroups.has(notebook.group_id));
  if (ungrouped.length) grouped.push({ id: "ungrouped", title: "其他笔记本", notebooks: ungrouped });

  function card(notebook: Notebook, compact = false) {
    return <div key={notebook.id} className={`notebook-overview-card${compact ? " is-compact" : ""}`}>
      <Link to={`/collections/${notebook.id}`} title={notebook.title} className="notebook-overview-card-link">
        <NotebookIcon icon={notebook.icon} />
        <span className="notebook-overview-card-copy"><strong>{notebook.title}</strong><span>更新于 {formatDate(notebook.updated_at_ms)}</span>{!compact && notesQuery.isSuccess ? <span className="notebook-overview-count">文档 {counts.get(notebook.id) ?? 0}</span> : null}</span>
      </Link>
      <ActionButton type="button" className={`notebook-overview-pin${isPinned(notebook.id) ? " is-pinned" : ""}`} title={isPinned(notebook.id) ? "移出快捷访问" : "加入快捷访问"} aria-label={`${isPinned(notebook.id) ? "移出快捷访问" : "加入快捷访问"}：${notebook.title}`} aria-pressed={isPinned(notebook.id)} onClick={() => togglePin(notebook.id)}><Pin size={16} /></ActionButton>
    </div>;
  }
  return <DocumentShell>
    <div className="notebook-overview">
      <PageContainer title="在线文档" description={`${notebooks.length} 个笔记本`} actions={<>{canEdit ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>新建笔记本</Button> : null}<Link to="/documents/collections" className="workbench-more">管理笔记本</Link></>}>

        {notebooksQuery.isLoading ? <LoadingState label="正在加载笔记本…" variant="cards" /> : null}
        {common.length ? <section className="notebook-overview-common" aria-label="快捷访问"><header className="workbench-section-heading"><h2>快捷访问</h2><ActionButton type="button" aria-expanded={!isCollapsed("common")} onClick={() => toggleGroup("common")}>{isCollapsed("common") ? "展开" : "收起"}</ActionButton></header>{!isCollapsed("common") ? <div className="notebook-overview-grid">{common.map((notebook) => card(notebook, true))}</div> : null}</section> : null}
        {grouped.map((group) => <section key={group.id} className="notebook-overview-group" aria-label={group.title}><header className="workbench-section-heading"><h2>{group.title}</h2></header><div className="notebook-overview-grid">{group.notebooks.map((notebook) => card(notebook))}</div></section>)}
        {!notebooksQuery.isLoading && !notebooksQuery.isError && !notebooks.length ? <div className="workbench-empty-section"><BookOpen size={28} /><h3>还没有笔记本</h3><p>创建笔记本，开始整理你的文档。</p>{canEdit ? <Button variant="secondary" onClick={() => setCreating(true)}>新建笔记本</Button> : null}</div> : null}
      </PageContainer>
    </div>
    <NotebookDialog open={creating} pending={createNotebook.isPending} onClose={() => setCreating(false)} onSubmit={async ({ title, icon }) => { const notebook = await createNotebook.mutateAsync({ title, icon, sort_order: notebooks.length }); setCreating(false); navigate(`/collections/${notebook.id}`); }} />
  </DocumentShell>;
}
