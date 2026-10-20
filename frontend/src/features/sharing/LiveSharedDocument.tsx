import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/api-client";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ContentRenderer } from "../content/ContentRenderer";
import { TableHostContext } from "../data-tables/context";
import {
  readSharedBlock,
  readSharedContent,
  type PublicShare,
  type SharedBlock,
  type SharedContentPage,
} from "./api";
import {
  hydratedSharedBlocks,
  pendingSharedBranches,
} from "./share-content-model";
import { PublicShareFiles } from "./PublicShareFiles";
import { ShareStatus } from "./ShareStatus";
import { LIVE_REFRESH_INTERVAL_MS } from "./sharing-config";

export function LiveSharedDocument({
  token,
  noteId,
  manifest,
}: {
  token: string;
  noteId: string;
  manifest: PublicShare;
}) {
  const first = useQuery({
    queryKey: ["public-share-content", token, noteId],
    queryFn: ({ signal }) => readSharedContent(token, noteId, { signal }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: LIVE_REFRESH_INTERVAL_MS,
  });
  const [additional, setAdditional] = useState<SharedContentPage[]>([]);
  const [payloads, setPayloads] = useState<SharedBlock[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [scope] = useState(() => ({
    controller: new AbortController(),
    consumers: 0,
  }));
  useEffect(() => {
    scope.consumers += 1;
    return () => {
      scope.consumers -= 1;
      queueMicrotask(() => {
        if (!scope.consumers) scope.controller.abort();
      });
    };
  }, [scope]);
  const version = first.data?.content_version;
  const currentPayloads = new Map(
    payloads
      .filter((payload) => payload.content_version === version)
      .map((payload) => [payload.id, payload]),
  );
  const pages = first.data
    ? [
        first.data,
        ...additional.filter((page) => page.content_version === version),
      ].map((page) => ({
        ...page,
        blocks: {
          ...page.blocks,
          blocks: page.blocks.blocks.map(
            (block) => currentPayloads.get(String(block.id))?.block ?? block,
          ),
        },
        descriptors: page.descriptors.map(
          (descriptor) =>
            currentPayloads.has(descriptor.id)?{...descriptor,payload_loaded:true}:descriptor,
        ),
      }))
    : [];
  const branches = pendingSharedBranches(pages);
  const missingPayloads = pages
    .flatMap((page) => page.descriptors)
    .filter((descriptor) => !descriptor.payload_loaded);
  const lastRoot = pages.filter((page) => page.parent_id === null).at(-1);
  async function load(parentId?: string) {
    if (!version || pending) return;
    setPending(parentId ?? "root");
    setError(null);
    const siblings = pages.filter(
      (page) => page.parent_id === (parentId ?? null),
    );
    const cursor = siblings.at(-1)?.next_cursor ?? null;
    try {
      const page = await readSharedContent(token, noteId, {
        parentId,
        cursor,
        version,
        signal: scope.controller.signal,
      });
      setAdditional((current) => [
        ...current.filter((item) => item.content_version === version),
        page,
      ]);
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        (cause.status === 409 || cause.status === 404)
      ) {
        setAdditional([]);
        void first.refetch();
      }
      setError(cause);
    } finally {
      setPending(null);
    }
  }
  async function loadPayload(blockId: string) {
    if (!version || pending) return;
    setPending(blockId);
    setError(null);
    try {
      const block = await readSharedBlock(
        token,
        noteId,
        blockId,
        version,
        scope.controller.signal,
      );
      setPayloads((current) => [
        ...current.filter(
          (item) =>
            item.content_version === version && item.id !== blockId,
        ),
        block,
      ]);
    } catch (cause) {
      setError(cause);
      if (
        cause instanceof ApiError &&
        (cause.status === 409 || cause.status === 404)
      ) {
        setAdditional([]);
        setPayloads([]);
        void first.refetch();
      }
    } finally {
      setPending(null);
    }
  }
  if (first.isPending || first.isError || !first.data)
    return (
      <ShareStatus
        loading={first.isPending}
        error={first.error}
        retry={() => void first.refetch()}
      />
    );
  if (error instanceof ApiError && error.status === 404)
    return (
      <ShareStatus
        loading={false}
        error={error}
        retry={() => {
          setError(null);
          void first.refetch();
        }}
      />
    );
  const blocks = hydratedSharedBlocks(
    pages,
    manifest,
    token,
    window.location.origin,
  );
  return (
    <article className="public-share-document">
      <header>
        <h1>{first.data.title}</h1>
        <p>
          在线正文 · 最后更新{" "}
          {new Date(first.data.updated_at_ms).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          })}
        </p>
      </header>
      <PublicShareFiles
        key={`${noteId}:${version}`}
        token={token}
        noteId={noteId}
      >
        <TableHostContext.Provider value={{ noteId, draftScope: "", auth: null, readOnly: true, shareToken: token }}><ContentRenderer blocks={blocks} pageTitle={first.data.title} /></TableHostContext.Provider>
      </PublicShareFiles>
      {error ? (
        <p role="alert">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      ) : null}
      {missingPayloads.length ? (
        <section
          className="share-pending-children"
          aria-label="按需加载较大内容"
        >
          <p>较大的单块内容单独加载。</p>
          {missingPayloads.map((descriptor) => (
            <ActionButton
              key={descriptor.id}
              isPending={pending === descriptor.id}
              disabled={Boolean(pending)}
              onClick={() => void loadPayload(descriptor.id)}
            >
              加载较大内容（{Math.ceil(descriptor.payload_bytes / 1024)} KiB）
            </ActionButton>
          ))}
        </section>
      ) : null}
      {branches.length ? (
        <section className="share-pending-children" aria-label="按需加载子内容">
          <p>以下容器还有子内容，可按需展开阅读。</p>
          {branches.map((branch) => (
            <ActionButton
              key={branch.id}
              isPending={pending === branch.id}
              disabled={Boolean(pending)}
              onClick={() => void load(branch.id)}
            >
              加载 {branch.label}（{branch.loaded}/{branch.count}）
            </ActionButton>
          ))}
        </section>
      ) : null}
      {lastRoot?.has_more ? (
        <ActionButton
          className="share-load-more"
          isPending={pending === "root"}
          disabled={Boolean(pending)}
          onClick={() => void load()}
        >
          继续阅读
        </ActionButton>
      ) : null}

    </article>
  );
}
