import { Component, lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { TableHostContext } from "../data-tables/context";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent, DialogFooter } from "../../shared/ui/Dialog";
import { LoadingState } from "../../shared/ui/LoadingState";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { AuthenticatedFileContent } from "../files/FileContent";
import { getNote, getNoteContent } from "./api";

const SavedContentRenderer = lazy(() => import("../content/ContentRenderer").then(module => ({ default: module.ContentRenderer })));
const previewQueryOptions = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/** A renderer or lazy-module failure must stay inside the read-only preview. */
class SavedPreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <StatusMessage tone="error" role="alert" title="正文预览未能显示">可以关闭预览后继续编辑，当前草稿仍然保留。</StatusMessage>
      : this.props.children;
  }
}

export type DocumentPreviewDialogProps = {
  noteId: string | null;
  title?: string;
  onClose: () => void;
};

/** Preview snapshots have their own cache so failures never change a live editor's query state. */
export function DocumentPreviewDialog({ noteId, title, onClose }: DocumentPreviewDialogProps) {
  if (!noteId) return null;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent title="文档预览" description="预览已保存的内容" className="document-preview-dialog">
      <SavedDocumentPreview key={noteId} noteId={noteId} title={title} onClose={onClose} />
    </DialogContent>
  </Dialog>;
}

function SavedDocumentPreview({ noteId, title, onClose }: { noteId: string; title?: string; onClose: () => void }) {
  const auth = useAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const note = useQuery({
    ...previewQueryOptions,
    queryKey: ["document-preview", sessionKey, noteId, "note"],
    queryFn: ({ signal }) => getNote(noteId, auth, signal),
  });
  const content = useQuery({
    ...previewQueryOptions,
    queryKey: ["document-preview", sessionKey, noteId, "content"],
    queryFn: ({ signal }) => getNoteContent(noteId, auth, signal),
  });
  const error = note.error ?? content.error;
  const loading = note.isPending || content.isPending;
  const refreshing = note.isFetching || content.isFetching;

  return <>
    <div className="document-preview-body">
      {error ? <StatusMessage tone="error" title="文档预览加载失败" role="alert">
        <p>{error instanceof Error ? error.message : "请稍后重试。"}</p>
        <Button disabled={refreshing} onClick={() => { void Promise.all([note.refetch(), content.refetch()]); }}>重新加载预览</Button>
      </StatusMessage> : loading ? <LoadingState label="正在加载文档预览…" variant="editor-body" /> : note.data && content.data ? <article className="document-preview-content" aria-label="已保存的文档内容">
        <h3 className="document-preview-title">{note.data.title || title || "未命名文档"}</h3>
        {refreshing ? <p className="document-preview-refresh" role="status">正在更新已保存的内容…</p> : null}
        <SavedPreviewBoundary><AuthenticatedFileContent>
          <Suspense fallback={<LoadingState label="正在渲染文档预览…" variant="editor-body" />}>
            <TableHostContext.Provider value={{ noteId, draftScope: "", auth, readOnly: true }}><SavedContentRenderer blocks={content.data.blocks} pageTitle={note.data.title} /></TableHostContext.Provider>
          </Suspense>
        </AuthenticatedFileContent></SavedPreviewBoundary>
      </article> : null}
    </div>
    <DialogFooter>
      <Button variant="ghost" onClick={onClose}>关闭预览</Button>
      {note.data && !error ? <Link className="document-preview-open" to={`/documents/${noteId}`} onClick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) onClose();
      }}>打开文档</Link> : null}
    </DialogFooter>
  </>;
}
