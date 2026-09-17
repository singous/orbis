import * as Dialog from "@radix-ui/react-dialog";
import { History, MessageSquare, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError } from "../../shared/api/api-client";
import type { NoteContent } from "../../shared/api/schemas";
import { ContentRenderer } from "../content/ContentRenderer";
import { useComments, useCreateComment, useRevision, useRevisions, useRestoreRevision, useUpdateComment } from "./queries";
import type { DocumentComment } from "./schemas";

export type RestoreSavedRevision = (expectedVersion: number) => Promise<NoteContent>;
type Props = { noteId: string; currentUserId: string; canManage: boolean; onClose: () => void; onRestore: (restore: RestoreSavedRevision) => Promise<void> };
const MAX_COMMENT_LENGTH = 10_000;
const timestamp = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });
function errorText(error: unknown) { return error instanceof ApiError ? error.message : error instanceof Error ? error.message : "操作失败，请稍后重试。"; }
function ErrorNotice({ error }: { error: unknown }) { return error ? <p className="collaboration-error" role="alert">{errorText(error)}</p> : null; }

function CommentForm({ label, submitLabel, initialBody = "", onSubmit, onCancel }: { label: string; submitLabel: string; initialBody?: string; onSubmit: (body: string) => Promise<void>; onCancel?: () => void }) {
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || pending) return;
    setPending(true); setError(null);
    try { await onSubmit(body.trim()); setBody(""); } catch (cause) { setError(cause); } finally { setPending(false); }
  }
  return <form className="collaboration-form" onSubmit={submit}>
    <label><span>{label}</span><textarea aria-label={label} value={body} onChange={(event) => setBody(event.target.value)} maxLength={MAX_COMMENT_LENGTH} rows={3} disabled={pending} required /></label>
    <ErrorNotice error={error} />
    <div className="collaboration-actions"><button className="mvp-button primary" type="submit" disabled={pending || !body.trim()}>{pending ? "正在提交…" : submitLabel}</button>{onCancel ? <button className="mvp-button secondary" type="button" disabled={pending} onClick={onCancel}>取消</button> : null}</div>
  </form>;
}

function CommentItem({ comment, parent, canManage, currentUserId, onChanged }: { comment: DocumentComment; parent?: DocumentComment; canManage: boolean; currentUserId: string; onChanged: (comment: DocumentComment) => void }) {
  const [mode, setMode] = useState<"edit" | "reply" | null>(null);
  const update = useUpdateComment(comment.note_id);
  const create = useCreateComment(comment.note_id);
  const isAuthor = currentUserId === comment.author_id;
  async function toggleResolved() {
    try { onChanged(await update.mutateAsync({ commentId: comment.id, is_resolved: !comment.is_resolved })); } catch { /* The mutation error is displayed below. */ }
  }
  return <article className={`collaboration-comment${comment.parent_id ? " is-reply" : ""}${comment.is_resolved ? " is-resolved" : ""}`}>
    {comment.parent_id ? <div className="collaboration-reply-context">回复 {parent?.author_name ?? "讨论"}{parent ? `：${parent.body.slice(0, 60)}` : "（原评论尚未加载）"}</div> : null}
    <header><strong>{comment.author_name}</strong><time dateTime={new Date(comment.created_at_ms).toISOString()} title="UTC+8">{timestamp.format(comment.created_at_ms)}</time>{comment.is_resolved ? <span className="collaboration-resolved">已解决</span> : null}</header>
    {mode === "edit" ? <CommentForm label="编辑评论正文" submitLabel="保存评论" initialBody={comment.body} onCancel={() => setMode(null)} onSubmit={async (body) => { onChanged(await update.mutateAsync({ commentId: comment.id, body })); setMode(null); }} /> : <p className="collaboration-comment-body">{comment.body}</p>}
    <div className="collaboration-actions">
      <button className="collaboration-text-button" type="button" aria-label="回复评论" onClick={() => setMode(mode === "reply" ? null : "reply")} disabled={create.isPending || update.isPending}>回复</button>
      {isAuthor ? <button className="collaboration-text-button" type="button" aria-label="编辑评论" disabled={update.isPending || create.isPending} onClick={() => setMode("edit")}>编辑</button> : null}
      {isAuthor || canManage ? <button className="collaboration-text-button" type="button" disabled={update.isPending || create.isPending} onClick={toggleResolved}>{comment.is_resolved ? "重新打开讨论" : "解决讨论"}</button> : null}
    </div>
    {mode !== "edit" ? <ErrorNotice error={update.error} /> : null}
    {mode === "reply" ? <CommentForm label="回复内容" submitLabel="发送回复" onCancel={() => setMode(null)} onSubmit={async (body) => { onChanged(await create.mutateAsync({ body, parent_id: comment.id })); setMode(null); }} /> : null}
  </article>;
}

function Comments({ noteId, canManage, currentUserId }: Pick<Props, "noteId" | "canManage" | "currentUserId">) {
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
    {query.isPending ? <p role="status">正在加载评论…</p> : null}
    <ErrorNotice error={query.error} />
    {query.isError ? <button type="button" className="mvp-button secondary" onClick={() => void query.refetch()}>重试加载评论</button> : null}
    {!query.isPending && !query.isError && comments.length === 0 ? <p className="collaboration-empty">暂无评论，写下第一条想法。</p> : null}
    <div className="collaboration-comments">{comments.map((comment) => <CommentItem key={comment.id} comment={comment} parent={comment.parent_id ? byId.get(comment.parent_id) : undefined} canManage={canManage} currentUserId={currentUserId} onChanged={rememberComment} />)}</div>
    {query.hasNextPage ? <button type="button" className="mvp-button secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "正在加载…" : "加载更多评论"}</button> : null}
  </section>;
}

function Revisions({ noteId, canManage, onRestore, onBusyChange }: Pick<Props, "noteId" | "canManage" | "onRestore"> & { onBusyChange: (busy: boolean) => void }) {
  const query = useRevisions(noteId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useRevision(noteId, selectedId);
  const restore = useRestoreRevision(noteId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [restored, setRestored] = useState(false);
  async function restoreSelected() {
    if (!selectedId || pending || !canManage) return;
    setPending(true); onBusyChange(true); setError(null); setRestored(false);
    try { await onRestore((expectedVersion) => restore.mutateAsync({ revisionId: selectedId, expectedVersion })); setRestored(true); }
    catch (cause) { setError(cause instanceof ApiError && cause.isConflict ? new Error("文档已在其他位置更新。当前正文仍保留，请先关闭面板处理版本冲突后再恢复。") : cause); }
    finally { setPending(false); onBusyChange(false); }
  }
  return <section aria-label="文档历史版本" className="collaboration-section">
    <p className="collaboration-hint">每次正文保存保留一个版本，恢复前的正文也会留在历史中。</p>
    {!canManage ? <p className="collaboration-hint">只读成员可以查看历史，恢复需要编辑权限。</p> : null}
    {query.isPending ? <p role="status">正在加载历史…</p> : null}
    <ErrorNotice error={query.error} />
    {query.isError ? <button type="button" className="mvp-button secondary" onClick={() => void query.refetch()}>重试加载历史</button> : null}
    {query.data?.pages[0].items.length === 0 ? <p className="collaboration-empty">暂无历史版本，首次保存正文后会在这里显示。</p> : null}
    <div className="collaboration-revisions">{query.data?.pages.flatMap((page) => page.items).map((revision) => <button type="button" className="collaboration-revision" key={revision.id} aria-label={`查看版本 ${revision.content_version}`} aria-pressed={selectedId === revision.id} disabled={pending} onClick={() => { setSelectedId(revision.id); setError(null); setRestored(false); }}><span>版本 {revision.content_version}</span><small>{revision.author_name} · {timestamp.format(revision.created_at_ms)}</small></button>)}</div>
    {query.hasNextPage ? <button type="button" className="mvp-button secondary" disabled={query.isFetchingNextPage || pending} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "正在加载…" : "加载更多版本"}</button> : null}
    {selectedId ? <div className="collaboration-preview">
      {detail.isPending ? <p role="status">正在加载版本正文…</p> : null}
      <ErrorNotice error={detail.error} />
      {detail.isError ? <button type="button" className="mvp-button secondary" onClick={() => void detail.refetch()}>重试加载正文</button> : null}
      {detail.data ? <><h3>版本 {detail.data.content_version} 预览</h3><ContentRenderer blocks={detail.data.blocks} />{canManage ? <div className="collaboration-restore"><p className="collaboration-hint">恢复会先保存当前草稿，再将此正文保存为新版本。文档标题保持当前值。</p><button className="mvp-button primary" type="button" onClick={restoreSelected} disabled={pending}>{pending ? "正在保存草稿并恢复…" : "恢复此版本"}</button></div> : null}</> : null}
      <ErrorNotice error={error} />
      {restored ? <p className="collaboration-success" role="status" aria-label="恢复结果">已恢复为新版本，原正文可在历史中找回。</p> : null}
    </div> : null}
  </section>;
}

export function DocumentCollaborationPanel(props: Props) {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"comments" | "revisions">("comments");
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) props.onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="collaboration-overlay" /><Dialog.Content className="collaboration-panel" aria-describedby="collaboration-description">
      <header className="collaboration-panel-header"><div><Dialog.Title>评论与历史</Dialog.Title><Dialog.Description id="collaboration-description">讨论文档，查看和恢复已保存的正文。</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" type="button" aria-label="关闭评论与历史" disabled={busy}><X size={18} aria-hidden="true" /></button></Dialog.Close></header>
      <div className="collaboration-tabs" aria-label="协作面板内容"><button type="button" disabled={busy} aria-pressed={tab === "comments"} onClick={() => setTab("comments")}><MessageSquare size={15} aria-hidden="true" />评论</button><button type="button" disabled={busy} aria-pressed={tab === "revisions"} onClick={() => setTab("revisions")}><History size={15} aria-hidden="true" />历史版本</button></div>
      <div className="collaboration-panel-scroll"><div hidden={tab !== "comments"}><Comments {...props} /></div>{tab === "revisions" ? <Revisions {...props} onBusyChange={setBusy} /> : null}</div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
