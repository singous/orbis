import { Spinner } from "@orbis/ui/spinner";
import { Button } from "@orbis/ui/button";
import { sharePendingChildrenClassName, sharePendingDescriptionClassName } from "./sharing-styles";
import { reportError } from "../../shared/api/request-feedback";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/api-client";
import { ContentRenderer } from "../content/ContentRenderer";
import { TableHostContext } from "../data-tables/context";
import {
  readSharedBlock,
  readSharedContent,
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
}: {
  token: string;
  noteId: string;
}) {
  const first = useQuery({
    queryKey: ["public-share-content", token, noteId],
    queryFn: ({ signal }) => readSharedContent(token, noteId, { signal }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: query => query.state.status === "error" ? false : LIVE_REFRESH_INTERVAL_MS,
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
    } catch (cause) { reportError(cause);
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
    } catch (cause) { reportError(cause);
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
    );
  return (
    <article className="mx-auto max-w-225 px-12 pt-12 pb-24 max-[760px]:px-5 max-[760px]:pt-8 max-[760px]:pb-16">
      <header className="mb-10">
        <h1 className="text-[clamp(1.8rem,3vw,2.5rem)] leading-[1.25] font-[650] tracking-[-.035em]">{first.data.title}</h1>
        <p className="mt-3 text-[.8rem] text-muted-foreground">
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

      {missingPayloads.length ? (
        <section
          className={sharePendingChildrenClassName}
          aria-label="按需加载较大内容"
        >
          <p className={sharePendingDescriptionClassName}>较大的单块内容单独加载。</p>
          {missingPayloads.map((descriptor) => (
            <Button
              key={descriptor.id}
              disabled={(pending === descriptor.id) || (Boolean(pending))}
              onClick={() => void loadPayload(descriptor.id)} variant="ghost" focusableWhenDisabled={(pending === descriptor.id) && !(Boolean(pending))} aria-busy={pending === descriptor.id || undefined}
            >{pending === descriptor.id ? <Spinner aria-hidden="true" /> : null}
              加载较大内容（{Math.ceil(descriptor.payload_bytes / 1024)} KiB）
            </Button>
          ))}
        </section>
      ) : null}
      {branches.length ? (
        <section className={sharePendingChildrenClassName} aria-label="按需加载子内容">
          <p className={sharePendingDescriptionClassName}>以下容器还有子内容，可按需展开阅读。</p>
          {branches.map((branch) => (
            <Button
              key={branch.id}
              disabled={(pending === branch.id) || (Boolean(pending))}
              onClick={() => void load(branch.id)} variant="ghost" focusableWhenDisabled={(pending === branch.id) && !(Boolean(pending))} aria-busy={pending === branch.id || undefined}
            >{pending === branch.id ? <Spinner aria-hidden="true" /> : null}
              加载 {branch.label}（{branch.loaded}/{branch.count}）
            </Button>
          ))}
        </section>
      ) : null}
      {lastRoot?.has_more ? (
        <Button
          className="mx-auto mt-8 block"
          disabled={(pending === "root") || (Boolean(pending))}
          onClick={() => void load()} variant="ghost" focusableWhenDisabled={(pending === "root") && !(Boolean(pending))} aria-busy={pending === "root" || undefined}
        >{pending === "root" ? <Spinner aria-hidden="true" /> : null}
          继续阅读
        </Button>
      ) : null}

    </article>
  );
}
