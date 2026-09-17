import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { previewSite } from "./api";
import { SiteReader } from "./SiteReader";
import { AuthenticatedFileContent } from "../files/FileContent";
import { ReaderStatus } from "./ReaderStatus";
import { PublicSiteDelivery } from "./PublicSiteDelivery";

export function PublicSitePage() {
  return <PublicSiteDelivery />;
}

export function SitePreviewPage() {
  const { siteId = "", pageSlug, "*": rest } = useParams();
  const auth = useAuthRequest();
  const query = useQuery({ queryKey: ["site-preview", siteId], queryFn: () => previewSite(siteId, auth), retry: false, staleTime: 0 });
  return <><div className="site-preview-back"><Link to={`/sites/${siteId}`}>← 返回发布管理</Link></div>{!query.isError && query.data ? <AuthenticatedFileContent><SiteReader snapshot={query.data} pageSlug={rest || pageSlug} basePath={`/sites/${siteId}/preview`} preview /></AuthenticatedFileContent> : <ReaderStatus loading={query.isPending} error={query.error} retry={() => void query.refetch()} />}</>;
}
