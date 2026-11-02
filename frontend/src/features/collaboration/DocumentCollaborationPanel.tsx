import { Spinner } from "@orbis/ui/spinner";
import {
  collaborationHintClassName,
  collaborationFormClassName,
  collaborationActionsClassName,
  collaborationEmptyClassName,
  collaborationRevisionClassName,
  collaborationPreviewClassName,
  collaborationRestoreClassName,
  collaborationLabelClassName,
  collaborationTextareaClassName,
  collaborationRevisionMetaClassName,
  collaborationPreviewTitleClassName,
} from "./collaboration-styles";

import { Button } from "@orbis/ui/button";
import { reportError } from "../../shared/api/request-feedback";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Badge } from "@orbis/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";
import { Textarea } from "@orbis/ui/textarea";

import { Sheet, SheetContent, SheetTitle } from "@orbis/ui/sheet";
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
  return <form className={collaborationFormClassName} onSubmit={submit}>
    <label className={collaborationLabelClassName}><span>{label}</span><Textarea className={collaborationTextareaClassName} aria-label={label} value={body} onChange={(event) => setBody(event.target.value)} maxLength={MAX_COMMENT_LENGTH} rows={3} disabled={pending} required /></label>
    <div className={collaborationActionsClassName}><Button variant="default" type="submit" disabled={pending || !body.trim()}>{pending ? "正在提交…" : submitLabel}</Button>{onCancel ? <Button variant="secondary" type="button" disabled={pending} onClick={onCancel}>取消</Button> : null}</div>
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
  return <article className={`border-t border-border py-5 [&>form]:mt-3 ${comment.parent_id ? "ms-4.5 border-s-2 ps-3.5" : ""}`}>
    {comment.parent_id ? <div className="mb-2.5 wrap-anywhere text-xs text-(--muted-foreground)">回复 {parent?.author_name ?? "讨论"}{parent ? `：${parent.body.slice(0, 60)}` : "（原评论尚未加载）"}</div> : null}
    <header className="flex flex-wrap items-baseline gap-2 text-xs"><strong>{comment.author_name}</strong><time className="text-xs text-(--muted-foreground)" dateTime={new Date(comment.created_at_ms).toISOString()} title="UTC+8">{timestamp.format(comment.created_at_ms)}</time>{comment.is_resolved ? <Badge variant="secondary">已解决</Badge> : null}</header>
    {mode === "edit" ? <CommentForm label="编辑评论正文" submitLabel="保存评论" initialBody={comment.body} onCancel={() => setMode(null)} onSubmit={async (body) => { onChanged(await update.mutateAsync({ commentId: comment.id,expected_version:editingVersion??comment.version, body })); setMode(null); }} /> : <p className="mt-3 mb-1.75 whitespace-pre-wrap wrap-anywhere text-sm">{comment.body}</p>}
    <div className={collaborationActionsClassName}>
      <Button size="sm" type="button" aria-label="回复评论" onClick={() => setMode(mode === "reply" ? null : "reply")} disabled={create.isPending || update.isPending} variant="link">回复</Button>
      {isAuthor ? <Button size="sm" type="button" aria-label="编辑评论" disabled={update.isPending || create.isPending} onClick={() => {setEditingVersion(comment.version);setMode("edit");}} variant="link">编辑</Button> : null}
      {isAuthor || canManage ? <Button size="sm" type="button" disabled={update.isPending || create.isPending} onClick={toggleResolved} variant="link">{comment.is_resolved ? "重新打开讨论" : "解决讨论"}</Button> : null}
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
  return <section aria-label="文档评论" className="grid gap-5">
    <p className={collaborationHintClassName}>在这里讨论整篇文档，所有空间成员都可参与。</p>
    <CommentForm label="新评论" submitLabel="发表评论" onSubmit={async (body) => { rememberComment(await create.mutateAsync({ body })); }} />
    {query.isPending ? <LoadingState label="正在加载评论…" compact /> : null}

    {query.isError ? <Button variant="secondary" type="button" onClick={() => void query.refetch()}>重试加载评论</Button> : null}
    {!query.isPending && !query.isError && comments.length === 0 ? <p className={collaborationEmptyClassName}>暂无评论，写下第一条想法。</p> : null}
    <div className="collaboration-comments">{comments.map((comment) => <CommentItem key={comment.id} comment={comment} parent={comment.parent_id ? byId.get(comment.parent_id) : undefined} canManage={canManage} currentUserId={currentUserId} onChanged={rememberComment} />)}</div>
    {query.hasNextPage ? <Button variant="secondary" type="button"  disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} aria-busy={query.isFetchingNextPage || undefined}>{query.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}{query.isFetchingNextPage ? "正在加载…" : "加载更多评论"}</Button> : null}
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
  return <section aria-label="文档历史版本" className="grid gap-5">
    <p className={collaborationHintClassName}>这里保留了逐次保存记录，可用于查找较早的内容。</p>
    {!canManage ? <p className={collaborationHintClassName}>只读成员可以查看历史，恢复需要编辑权限。</p> : null}
    {query.isPending ? <LoadingState label="正在加载历史…" compact /> : null}

    {query.isError ? <Button variant="secondary" type="button" onClick={() => void query.refetch()}>重试加载历史</Button> : null}
    {query.data?.pages[0].items.length === 0 ? <p className={collaborationEmptyClassName}>暂无历史版本，首次保存正文后会在这里显示。</p> : null}
    <div className="grid gap-1.25">{query.data?.pages.flatMap((page) => page.items).map((revision) => <Button type="button" className={collaborationRevisionClassName} key={revision.id} aria-label={`查看保存记录 ${revision.content_version}`} aria-pressed={selectedId === revision.id} disabled={pending} onClick={() => { setSelectedId(revision.id);  }} variant="ghost"><span>{timestamp.format(revision.created_at_ms)}</span><small className={collaborationRevisionMetaClassName}>{revision.author_name} · {timestamp.format(revision.created_at_ms)}</small></Button>)}</div>
    {query.hasNextPage ? <Button variant="secondary" type="button"  disabled={query.isFetchingNextPage || (query.isFetchingNextPage || pending)} onClick={() => void query.fetchNextPage()} aria-busy={query.isFetchingNextPage || undefined}>{query.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}{query.isFetchingNextPage ? "正在加载…" : "加载更多版本"}</Button> : null}
    {selectedId ? <div className={collaborationPreviewClassName}>
      {detail.isPending ? <LoadingState label="正在加载版本正文…" variant="editor" /> : null}

      {detail.isError ? <Button variant="secondary" type="button" onClick={() => void detail.refetch()}>重试加载正文</Button> : null}
      {detail.data ? <><h3 className={collaborationPreviewTitleClassName}>保存记录预览</h3><RevisionContent noteId={noteId} version={detail.data.content_version} blocks={detail.data.blocks}/>{canManage ? <div className={collaborationRestoreClassName}><p className={collaborationHintClassName}>恢复会先保存当前草稿，再将此正文保存为新版本。标题也会恢复至该版本；未记录标题的旧版本保留当前标题。</p><Button variant="default" type="button" onClick={restoreSelected} disabled={pending}>{pending ? "正在保存草稿并恢复…" : "恢复此版本"}</Button></div> : null}</> : null}

    </div> : null}
  </section>;
}

export function DocumentCollaborationPanel(props: Props) {
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [tab, setTab] = useState<"comments" | "revisions">("comments");
  return <Sheet open={props.open ?? true}   onOpenChange={(open, details) => { if (!open && busy) { details.cancel(); return; } if (!open) props.onClose(); }} disablePointerDismissal={busy}>
    <SheetContent showCloseButton={false} className="collaboration-panel flex flex-col gap-0 p-0" aria-describedby="collaboration-description">
      <header className="flex items-start justify-between gap-5 border-b border-border px-6 pt-6.5 pb-5 max-[600px]:px-4.5 max-[600px]:pt-[max(20px,env(safe-area-inset-top))] max-[600px]:pb-4.5"><div><SheetTitle className="mt-0 mb-1.5 text-base leading-6 font-semibold">评论与历史</SheetTitle><p id="collaboration-description" className="m-0 text-xs text-(--muted-foreground)">讨论文档，查看和恢复已保存的正文。</p></div><Button  type="button" aria-label="关闭评论与历史" disabled={busy} onClick={props.onClose} variant="ghost" size="icon"><X size={18} aria-hidden="true" /></Button></header>
      <Tabs className="flex min-h-0 flex-1 flex-col gap-0" value={tab} onValueChange={(key) => { if (key === "comments" || key === "revisions") setTab(key); }}>
        <div className="flex gap-2 border-b border-border px-6 py-3.5 max-[600px]:px-4.5 max-[600px]:py-3"><TabsList activateOnFocus aria-label="协作面板内容">
          <TabsTrigger className="min-w-max whitespace-nowrap max-[600px]:min-h-(--ob-control-height-touch)" value="comments" disabled={busy}><MessageSquare size={16} aria-hidden="true" />评论</TabsTrigger>
          <TabsTrigger className="min-w-max whitespace-nowrap max-[600px]:min-h-(--ob-control-height-touch)" value="revisions" disabled={busy}><History size={16} aria-hidden="true" />历史版本</TabsTrigger>
        </TabsList></div>
        <div className="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-5.5 pb-[max(24px,env(safe-area-inset-bottom))] max-[600px]:px-4.5 max-[600px]:pt-4.5"><TabsContent value="comments" keepMounted><div hidden={tab !== "comments"}><DocumentComments {...props} /></div></TabsContent><TabsContent value="revisions">{tab === "revisions" ? legacy ? <><Button type="button" variant="secondary" disabled={busy} onClick={() => setLegacy(false)}>返回版本时间线</Button><Revisions {...props} onBusyChange={setBusy} /></> : <DocumentVersions {...props} onPrepare={props.onPrepareVersion} onBusyChange={setBusy} onLegacy={() => setLegacy(true)} /> : null}</TabsContent></div>
      </Tabs>
    </SheetContent>
  </Sheet>;
}
