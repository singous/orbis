import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../shared/api/api-client";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { getPublicSite, previewSite } from "./api";
import { SiteReader } from "./SiteReader";

function ReaderStatus({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  return <main className="site-reader-status"><h1>{loading ? "正在打开文档…" : missing ? "站点尚未发布或已撤回" : "暂时无法打开站点"}</h1>{!loading ? <><p>{missing ? "请确认地址，或联系站点维护者。" : error instanceof ApiError ? error.message : "连接出现问题，请稍后重试。"}</p><button type="button" className="mvp-button" onClick={retry}>重新加载</button></> : null}</main>;
}

export function PublicSitePage() {
  const { slug = "", pageSlug } = useParams();
  const query = useQuery({ queryKey: ["public-site", slug], queryFn: () => getPublicSite(slug), retry: false });
  if (query.isError || !query.data) return <ReaderStatus loading={query.isPending} error={query.error} retry={() => void query.refetch()} />;
  return <SiteReader snapshot={query.data} pageSlug={pageSlug} basePath={`/s/${encodeURIComponent(slug)}`} />;
}

export function SitePreviewPage() {
  const { siteId = "", pageSlug } = useParams();
  const auth = useAuthRequest();
  const query = useQuery({ queryKey: ["site-preview", siteId], queryFn: () => previewSite(siteId, auth), retry: false, staleTime: 0 });
  return <><div className="site-preview-back"><Link to={`/sites/${siteId}`}>← 返回发布管理</Link></div>{!query.isError && query.data ? <SiteReader snapshot={query.data} pageSlug={pageSlug} basePath={`/sites/${siteId}/preview`} preview /> : <ReaderStatus loading={query.isPending} error={query.error} retry={() => void query.refetch()} />}</>;
}
