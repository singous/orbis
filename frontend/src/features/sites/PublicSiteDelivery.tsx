import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ApiError } from "../../shared/api/api-client";
import { getPublicMarkdown, getPublicPage, getPublicSearch, getSiteManifest } from "./delivery-api";
import { readSiteBootstrap } from "./delivery-schemas";
import { resolveRedirect } from "./reader/reader-model";
import { ReaderStatus } from "./ReaderStatus";
import { SiteReader } from "./SiteReader";
import type { SiteSnapshot } from "./schemas";

const EMPTY_BLOCKS = { schema_version: 2, editor: "blocknote", blocks: [] };

export function PublicSiteDelivery() {
  const params = useParams();
  const slug = params.slug || "";
  const pageSlug = params["*"] || params.pageSlug || undefined;
  const client = useQueryClient();
  const [bootstrap] = useState(readSiteBootstrap);
  const initial = bootstrap?.manifest.slug === slug ? bootstrap : null;
  const manifest = useQuery({
    queryKey: ["public-site", slug, "manifest"],
    queryFn: ({ signal }) => getSiteManifest(slug, signal),
    initialData: initial?.manifest,
    retry: false,
  });
  const currentSlug = resolveRedirect(pageSlug, manifest.data?.redirects) || pageSlug || manifest.data?.pages[0]?.slug || "";
  const knownPage = manifest.data?.pages.some((page) => page.slug === currentSlug) ?? false;
  const releaseId = manifest.data?.release_id ?? null;
  const page = useQuery({
    queryKey: ["public-site", slug, "page", releaseId, currentSlug],
    queryFn: ({ signal }) => getPublicPage(slug, currentSlug, releaseId, signal),
    enabled: Boolean(manifest.data && knownPage),
    initialData: initial?.page.page.slug === currentSlug && initial.page.release_id === releaseId ? initial.page : undefined,
    retry: false,
  });
  const recoveries = useRef(new Set<string>());
  const recoverRelease = useCallback((error: unknown) => {
    if (!(error instanceof ApiError) || ![404, 409].includes(error.status)) return;
    const key = `${slug}:${releaseId}`;
    if (recoveries.current.has(key)) return;
    recoveries.current.add(key);
    void client.invalidateQueries({ queryKey: ["public-site", slug, "manifest"] });
  }, [client, slug, releaseId]);
  useEffect(() => { if (page.error) recoverRelease(page.error); }, [page.error, recoverRelease]);
  useEffect(() => { document.getElementById("orbis-site-bootstrap")?.remove(); }, []);

  const loadSearch = useCallback(async (query:string,signal?:AbortSignal) => {
    try {
      const result = await client.fetchQuery({
        queryKey: ["public-site", slug, "search", releaseId,query],
        queryFn: ({ signal:querySignal }) => getPublicSearch(slug,releaseId,query,signal??querySignal),
        staleTime: 0, retry: false,
      });
      return result.pages.map(item=>{
        const metadata=manifest.data?.pages.find(page=>page.slug===item.slug);
        if(!metadata)throw new ApiError(502,"搜索结果不属于当前发布版本。","API_RESPONSE_INVALID");
        return {...metadata,...item,blocks:EMPTY_BLOCKS};
      });
    } catch (error) { recoverRelease(error); throw error; }
  }, [client, slug, releaseId, recoverRelease,manifest.data]);
  const loadMarkdown = useCallback(async (target: string) => {
    try { return await getPublicMarkdown(slug, target, releaseId); }
    catch (error) { recoverRelease(error); throw error; }
  }, [slug, releaseId, recoverRelease]);
  const current = page.data?.release_id === releaseId && page.data.page.slug === currentSlug ? page.data.page : undefined;
  const snapshot = useMemo<SiteSnapshot | null>(() => manifest.data ? {
    ...manifest.data,
    pages: manifest.data.pages.map((item) => item.slug === current?.slug ? current : { ...item, blocks: EMPTY_BLOCKS, plain_text: "" }),
  } : null, [manifest.data, current]);
  if (manifest.isError || !snapshot) return <ReaderStatus loading={manifest.isPending} error={manifest.error} retry={() => void manifest.refetch()} />;
  return <SiteReader snapshot={snapshot} pageSlug={pageSlug} basePath={`/s/${encodeURIComponent(slug)}`}
    canonicalBasePath={manifest.data?.canonical_base_url??new URL(`/s/${encodeURIComponent(manifest.data?.slug??slug)}`,window.location.href).href}
    loadSearch={loadSearch} loadMarkdown={loadMarkdown} contentState={{
      loading: knownPage && !current && !page.isError,
      error: page.isError ? page.error instanceof ApiError ? page.error.message : "暂时无法加载正文，请重试。" : undefined,
      retry: () => { recoveries.current.delete(`${slug}:${releaseId}`); void page.refetch(); },
    }} />;
}
