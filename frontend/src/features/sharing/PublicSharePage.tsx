import { Button } from "@orbis/ui/button";
import { ReadStatus } from "../../shared/ui/ReadStatus";
import { OrbisAttribution } from "../../shared/ui/OrbisAttribution";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { BookOpen, RefreshCw } from "@orbis/ui/icons";
import { useReaderMetadata } from "../sites/reader/head-metadata";
import { readPublicShare,readSharedDocument } from "./api";
import { LiveSharedDocument } from "./LiveSharedDocument";
import { ShareDirectory } from "./ShareDirectory";
import { ShareStatus } from "./ShareStatus";
import { LIVE_REFRESH_INTERVAL_MS } from "./sharing-config";

export function PublicSharePage() {
  const client = useQueryClient();
  const { shareToken = "", noteId } = useParams();
  const manifest = useQuery({
    queryKey: ["public-share", shareToken],
    queryFn: ({ signal }) => readPublicShare(shareToken, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: query => query.state.status === "error" ? false : LIVE_REFRESH_INTERVAL_MS,
  });
  useReaderMetadata(
    `${manifest.data?.title ?? "在线文档分享"} · Orbis`,
    "实时在线文档分享",
    undefined,
    true,
  );
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  }, [shareToken, noteId]);
  const selectedId=noteId??manifest.data?.root_note_id??manifest.data?.items[0]?.id;
  const selected=useQuery({queryKey:["public-share-document",shareToken,selectedId,manifest.data?.directory_version],queryFn:({signal})=>readSharedDocument(shareToken,selectedId!,signal),enabled:Boolean(manifest.data&&selectedId),retry:false,staleTime:0,gcTime:0,refetchInterval: query => query.state.status === "error" ? false : LIVE_REFRESH_INTERVAL_MS});
  const unavailable = manifest.isPending || manifest.isError || !manifest.data;
  const Frame = unavailable ? "main" : "div";
  return (
    <Frame data-ui="public-share" data-theme="light" className={`min-h-screen bg-background text-foreground ${unavailable ? "" : "public-share-reader"}`}>
      {unavailable ? <ShareStatus loading={manifest.isPending} error={manifest.error} retry={() => void manifest.refetch()} /> : <>
      <a className="fixed -top-25 left-4 z-10 bg-background p-[.6rem] focus:top-2" href="#shared-document">
        跳转到正文
      </a>
      <header className="sticky top-0 z-3 flex h-16.5 items-center gap-6 border-b border-border bg-background px-8 [&>span]:shrink-0 max-[760px]:gap-3 max-[760px]:px-4">
        <Link className="flex min-w-0 flex-1 items-center gap-[.65rem] font-[650] text-inherit no-underline [&>svg]:shrink-0" to={`/share/${encodeURIComponent(shareToken)}`}>
          <BookOpen size={19} aria-hidden="true" />
          <span className="truncate">{manifest.data.title}</span>
        </Link>
        <OrbisAttribution appearance="share" />
        <Button
          className="shrink-0 max-[760px]:ms-auto"
          aria-label="刷新目录与正文"
          onClick={() => {
            void manifest.refetch();
            void client.invalidateQueries({queryKey:["public-share-document",shareToken]});
            void client.invalidateQueries({
              queryKey: ["public-share-content", shareToken],
            });
          }} variant="ghost"
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新
        </Button>
      </header>
      <div className="mx-auto grid max-w-370 grid-cols-[260px_minmax(0,1fr)] max-[760px]:grid-cols-1">
        <aside className="min-h-[calc(100vh-66px)] border-e border-border px-5 py-8 max-[760px]:max-h-60 max-[760px]:min-h-0 max-[760px]:overflow-auto max-[760px]:border-e-0 max-[760px]:border-b max-[760px]:p-4">
          <ShareDirectory
            manifest={manifest.data}
            token={shareToken}
            selectedId={selectedId}
          />
          <p className="mt-8 text-xs text-muted-foreground max-[760px]:hidden">正文及目录与在线文档保持同步</p>
        </aside>
        <main id="shared-document" className="min-w-0" tabIndex={-1}>
          {selected.data && !selected.isError ? (
            <LiveSharedDocument
              key={`${shareToken}:${selected.data.id}`}
              token={shareToken}
              noteId={selected.data.id}
            />
          ) : selectedId ? (
            <ShareStatus
              loading={selected.isPending}
              error={selected.error}
              retry={() => void selected.refetch()}
            />
          ) : (
            <ReadStatus as="div" title="此范围还没有文档" message="新增文档后将自动出现在目录中。" />
          )}
        </main>
      </div>
      </>}
    </Frame>
  );
}
