import { OrbisLogo } from "../../shared/ui/OrbisLogo";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { BookOpen, RefreshCw } from "lucide-react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { useReaderMetadata } from "../sites/reader/head-metadata";
import { readPublicShare,readSharedDocument } from "./api";
import { LiveSharedDocument } from "./LiveSharedDocument";
import { ShareDirectory } from "./ShareDirectory";
import { ShareStatus } from "./ShareStatus";
import { LIVE_REFRESH_INTERVAL_MS } from "./sharing-config";
import "../../styles/document-sharing.css";

export function PublicSharePage() {
  const client = useQueryClient();
  const { shareToken = "", noteId } = useParams();
  const manifest = useQuery({
    queryKey: ["public-share", shareToken],
    queryFn: ({ signal }) => readPublicShare(shareToken, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: LIVE_REFRESH_INTERVAL_MS,
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
  const selected=useQuery({queryKey:["public-share-document",shareToken,selectedId,manifest.data?.directory_version],queryFn:({signal})=>readSharedDocument(shareToken,selectedId!,signal),enabled:Boolean(manifest.data&&selectedId),retry:false,staleTime:0,gcTime:0,refetchInterval:LIVE_REFRESH_INTERVAL_MS});
  if(manifest.isPending||manifest.isError||!manifest.data)return <ShareStatus loading={manifest.isPending} error={manifest.error} retry={()=>void manifest.refetch()}/>;
  return (
    <div className="public-share-reader">
      <a className="share-skip-link" href="#shared-document">
        跳转到正文
      </a>
      <header className="public-share-header">
        <Link to={`/share/${encodeURIComponent(shareToken)}`}>
          <BookOpen size={19} aria-hidden="true" />
          {manifest.data.title}
        </Link>
        <span className="orbis-attribution"><OrbisLogo size={20} />Orbis · 实时文档分享</span>
        <ActionButton
          aria-label="刷新目录与正文"
          onClick={() => {
            void manifest.refetch();
            void client.invalidateQueries({queryKey:["public-share-document",shareToken]});
            void client.invalidateQueries({
              queryKey: ["public-share-content", shareToken],
            });
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新
        </ActionButton>
      </header>
      <div className="public-share-layout">
        <aside>
          <ShareDirectory
            manifest={manifest.data}
            token={shareToken}
            selectedId={selectedId}
          />
          <p>正文及目录与在线文档保持同步</p>
        </aside>
        <main id="shared-document">
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
            <div className="public-share-empty">
              <h1>此范围还没有文档</h1>
              <p>新增文档后将自动出现在目录中。</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
