import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Tag } from "../../shared/ui/Tag";
import { Tabs } from "@heroui/react/tabs";
import { TextArea as HeroTextArea } from "@heroui/react/textarea";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Drawer } from "@heroui/react/drawer";
import { History, MessageSquare, X } from "../../shared/ui/icons";
import { useState, type FormEvent } from "react";
import type { NoteContent } from "../../shared/api/schemas";
import { RevisionContent } from "./RevisionContent";
import { useComments, useCreateComment, useRevision, useRevisions, useRestoreRevision, useUpdateComment } from "./queries";
import { DocumentVersions } from "./DocumentVersions";
import type { DocumentComment } from "./schemas";

export type RestoreSavedRevision = (expectedVersion: number) => Promise<NoteContent>;
type Props = { noteId: string; currentUserId: string; canManage: boolean; open?: boolean; onClose: () => void; onRestore: (restore: RestoreSavedRevision) => Promise<void>; onPrepareVersion?: () => Promise<number> };
const MAX_COMMENT_LENGTH = 10_000;
const timestamp = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });

function CommentForm({ label, submitLabel, initialBody = "", onSubmit, onCancel }: { label: string; submitLabel: string; initialBody?: string; onSubmit: (body: string) => Promise<void>; onCancel?: () => void }) {
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || pending) return;
    setPending(true);
    try { await onSubmit(body.trim()); setBody(""); }
    catch (cause) { reportError(cause); }
    finally { setPending(false); }
  }
  return <form className="collaboration-form" onSubmit={submit}>
    <label><span>{label}</span><HeroTextArea aria-label={label} value={body} onChange={(event) => setBody(event.target.value)} maxLength={MAX_COMMENT_LENGTH} rows={3} disabled={pending} required /></label>
    <div className="collaboration-actions"><ActionButton variant="primary" className="mvp-button primary" type="submit" disabled={pending || !body.trim()}>{pending ? "正在提交…" : submitLabel}</ActionButton>{onCancel ? <ActionButton variant="secondary" className="mvp-button secondary" type="button" disabled={pending} onClick={onCancel}>取消</ActionButton> : null}</div>
  </form>;
}

function CommentItem({ comment, parent, canManage, currentUserId, onChanged }: { comment: DocumentComment; parent?: DocumentComment; canManage: boolean; currentUserId: string; onChanged: (comment: DocumentComment) => void }) {
  const [editingVersion,setEditingVersion]=useState<number|null>(null);
  const [mode, setMode] = useState<"edit" | "reply" | null>(null);
  const update = useUpdateComment(comment.note_id);
  const create = useCreateComment(comment.note_id);
  const isAuthor = currentUserId === comment.author_id;
  async function toggleResolved() {
    try { onChanged(await update.mutateAsync({ commentId: comment.id,expected_version:comment.version, is_resolved: !comment.is_resolved })); }
    catch (cause) { reportError(cause); }
  }
  return <article className={`collaboration-comment${comment.parent_id ? " is-reply" : ""}${comment.is_resolved ? " is-resolved" : ""}`}>
    {comment.parent_id ? <div className="collaboration-reply-context">回复 {parent?.author_name ?? "讨论"}{parent ? `：${parent.body.slice(0, 60)}` : "（原评论尚未加载）"}</div> : null}
    <header><strong>{comment.author_name}</strong><time dateTime={new Date(comment.created_at_ms).toISOString()} title="UTC+8">{timestamp.format(comment.created_at_ms)}</time>{comment.is_resolved ? <Tag tone="success">已解决</Tag> : null}</header>
    {mode === "edit" ? <CommentForm label="编辑评论正文" submitLabel="保存评论" initialBody={comment.body} onCancel={() => setMode(null)} onSubmit={async (body) => { onChanged(await update.mutateAsync({ commentId: comment.id,expected_version:editingVersion??comment.version, body })); setMode(null); }} /> : <p className="collaboration-comment-body">{comment.body}</p>}
    <div className="collaboration-actions">
      <ActionButton className="collaboration-text-button" type="button" aria-label="回复评论" onClick={() => setMode(mode === "reply" ? null : "reply")} disabled={create.isPending || update.isPending}>回复</ActionButton>
      {isAuthor ? <ActionButton className="collaboration-text-button" type="button" aria-label="编辑评论" disabled={update.isPending || create.isPending} onClick={() => {setEditingVersion(comment.version);setMode("edit");}}>编辑</ActionButton> : null}
      {isAuthor || canManage ? <ActionButton className="collaboration-text-button" type="button" disabled={update.isPending || create.isPending} onClick={toggleResolved}>{comment.is_resolved ? "重新打开讨论" : "解决讨论"}</ActionButton> : null}
    </div>
    {mode === "reply" ? <CommentForm label="回复内容" submitLabel="发送回复" onCancel={() => setMode(null)} onSubmit={async (body) => { onChanged(await create.mutateAsync({ body, parent_id: comment.id })); setMode(null); }} /> : null}
  </article>;
}

export function DocumentComments({ noteId, canManage, currentUserId }: Pick<Props, "noteId" | "canManage" | "currentUserId">) {
  const query = useComments(noteId);
  const create = useCreateComment(noteId);
  const [recentComments, setRecentComments] = useState<DocumentComment[]>([]);
  const loaded = query.data?.pages.flatMap((page) => page.items) ?? [];
  const loadedIds = new Set(loaded.map((comment) => comment.id));
  // Newly posted comments can fall after unloaded pages. Keep the successful
  // server response visible until pagination reaches it, without duplication.
  const comments = [...loaded, ...recentComments.filter((comment) => !loadedIds.has(comment.id))];
  function rememberComment(comment: DocumentComment) {
    setRecentComments((current) => [...current.filter((item) => item.id !== comment.id), comment]);
  }
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  return <section aria-label="文档评论" className="collaboration-section">
    <p className="collaboration-hint">在这里讨论整篇文档，所有空间成员都可参与。</p>
    <CommentForm label="新评论" submitLabel="发表评论" onSubmit={async (body) => { rememberComment(await create.mutateAsync({ body })); }} />
    {query.isPending ? <LoadingState label="正在加载评论…" compact /> : null}

    {query.isError ? <ActionButton variant="secondary" type="button" className="mvp-button secondary" onClick={() => void query.refetch()}>重试加载评论</ActionButton> : null}
    {!query.isPending && !query.isError && comments.length === 0 ? <p className="collaboration-empty">暂无评论，写下第一条想法。</p> : null}
    <div className="collaboration-comments">{comments.map((comment) => <CommentItem key={comment.id} comment={comment} parent={comment.parent_id ? byId.get(comment.parent_id) : undefined} canManage={canManage} currentUserId={currentUserId} onChanged={rememberComment} />)}</div>
    {query.hasNextPage ? <ActionButton variant="secondary" type="button" className="mvp-button secondary" isPending={query.isFetchingNextPage} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "正在加载…" : "加载更多评论"}</ActionButton> : null}
  </section>;
}

function Revisions({ noteId, canManage, onRestore, onBusyChange }: Pick<Props, "noteId" | "canManage" | "onRestore"> & { onBusyChange: (busy: boolean) => void }) {
  const query = useRevisions(noteId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useRevision(noteId, selectedId);
  const restore = useRestoreRevision(noteId);
  const [pending, setPending] = useState(false);

  async function restoreSelected() {
    if (!selectedId || pending || !canManage) return;
    setPending(true); onBusyChange(true);
    try {
      await onRestore((expectedVersion) => restore.mutateAsync({ revisionId: selectedId, expectedVersion }));

    } catch (cause) { reportError(cause);
    }
    finally { setPending(false); onBusyChange(false); }
  }
  return <section aria-label="文档历史版本" className="collaboration-section">
    <p className="collaboration-hint">这里保留了逐次保存记录，可用于查找较早的内容。</p>
    {!canManage ? <p className="collaboration-hint">只读成员可以查看历史，恢复需要编辑权限。</p> : null}
    {query.isPending ? <LoadingState label="正在加载历史…" compact /> : null}

    {query.isError ? <ActionButton variant="secondary" type="button" className="mvp-button secondary" onClick={() => void query.refetch()}>重试加载历史</ActionButton> : null}
    {query.data?.pages[0].items.length === 0 ? <p className="collaboration-empty">暂无历史版本，首次保存正文后会在这里显示。</p> : null}
    <div className="collaboration-revisions">{query.data?.pages.flatMap((page) => page.items).map((revision) => <ActionButton type="button" className="collaboration-revision" key={revision.id} aria-label={`查看保存记录 ${revision.content_version}`} aria-pressed={selectedId === revision.id} disabled={pending} onClick={() => { setSelectedId(revision.id);  }}><span>{timestamp.format(revision.created_at_ms)}</span><small>{revision.author_name} · {timestamp.format(revision.created_at_ms)}</small></ActionButton>)}</div>
    {query.hasNextPage ? <ActionButton variant="secondary" type="button" className="mvp-button secondary" isPending={query.isFetchingNextPage} disabled={query.isFetchingNextPage || pending} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "正在加载…" : "加载更多版本"}</ActionButton> : null}
    {selectedId ? <div className="collaboration-preview">
      {detail.isPending ? <LoadingState label="正在加载版本正文…" variant="editor" /> : null}

      {detail.isError ? <ActionButton variant="secondary" type="button" className="mvp-button secondary" onClick={() => void detail.refetch()}>重试加载正文</ActionButton> : null}
      {detail.data ? <><h3>保存记录预览</h3><RevisionContent noteId={noteId} version={detail.data.content_version} blocks={detail.data.blocks}/>{canManage ? <div className="collaboration-restore"><p className="collaboration-hint">恢复会先保存当前草稿，再将此正文保存为新版本。标题也会恢复至该版本；未记录标题的旧版本保留当前标题。</p><ActionButton variant="primary" className="mvp-button primary" type="button" onClick={restoreSelected} disabled={pending}>{pending ? "正在保存草稿并恢复…" : "恢复此版本"}</ActionButton></div> : null}</> : null}

    </div> : null}
  </section>;
}

export function DocumentCollaborationPanel(props: Props) {
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [tab, setTab] = useState<"comments" | "revisions">("comments");
  return <Drawer.Backdrop isOpen={props.open ?? true} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open) => { if (!open && !busy) props.onClose(); }} className="collaboration-overlay">
    <Drawer.Content placement="right" className="collaboration-drawer"><Drawer.Dialog className="collaboration-panel" aria-describedby="collaboration-description">
      <header className="collaboration-panel-header"><div><Drawer.Heading>评论与历史</Drawer.Heading><p id="collaboration-description">讨论文档，查看和恢复已保存的正文。</p></div><ActionButton className="icon-button" type="button" aria-label="关闭评论与历史" disabled={busy} onClick={props.onClose}><X size={18} aria-hidden="true" /></ActionButton></header>
      <Tabs className="collaboration-tabs-root" selectedKey={tab} onSelectionChange={(key) => { if (key === "comments" || key === "revisions") setTab(key); }}>
        <Tabs.ListContainer className="collaboration-tabs"><Tabs.List aria-label="协作面板内容">
          <Tabs.Tab id="comments" isDisabled={busy}><MessageSquare size={16} aria-hidden="true" />评论<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="revisions" isDisabled={busy}><History size={16} aria-hidden="true" />历史版本<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List></Tabs.ListContainer>
        <Drawer.Body className="collaboration-panel-scroll"><Tabs.Panel id="comments" shouldForceMount><div className="collaboration-tab-content" hidden={tab !== "comments"}><DocumentComments {...props} /></div></Tabs.Panel><Tabs.Panel id="revisions">{tab === "revisions" ? legacy ? <><ActionButton type="button" variant="secondary" disabled={busy} onClick={() => setLegacy(false)}>返回版本时间线</ActionButton><Revisions {...props} onBusyChange={setBusy} /></> : <DocumentVersions {...props} onPrepare={props.onPrepareVersion} onBusyChange={setBusy} onLegacy={() => setLegacy(true)} /> : null}</Tabs.Panel></Drawer.Body>
      </Tabs>
    </Drawer.Dialog></Drawer.Content>
  </Drawer.Backdrop>;
}
