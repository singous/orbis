import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { FileContentContext } from "../files/FileContent";
import { parseFileReference } from "../files/managed-files";

export const ContentLinkContext = createContext<{
  resolve: (href: string) => string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
} | null>(null);

function useContentResource(reference: string | undefined, fallback: string | null) {
  const files = useContext(FileContentContext);
  const managed = Boolean(reference && parseFileReference(reference));
  const [attempt, setAttempt] = useState(0);
  const key = `${files?.scope ?? "public"}:${reference}:${attempt}`;
  const [result, setResult] = useState<{ key: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!managed || !files || !reference) return;
    let active = true;
    void files.resolve(reference).then((url) => {
      if (active) setResult({ key, url, failed: false });
    }).catch(() => {
      if (active) setResult({ key, url: null, failed: true });
    });
    return () => { active = false; };
  }, [managed, reference, files, key]);
  const current = result?.key === key ? result : null;
  return {
    url: managed ? current?.url ?? null : fallback,
    managed,
    loading: managed && Boolean(files) && !current,
    canRetry: managed && Boolean(files) && current?.failed,
    retry: () => setAttempt((value) => value + 1),
  };
}

export function ContentMedia({ kind, reference, fallback, name, caption }: {
  kind: "image" | "video" | "audio" | "file";
  reference?: string;
  fallback: string | null;
  name: string;
  caption?: string;
}) {
  const resource = useContentResource(reference, fallback);
  if (!resource.url) return <p className="content-unavailable">{name}（{resource.loading ? "正在加载…" : "资源不可用"}）{resource.canRetry ? <button type="button" onClick={resource.retry}>重新加载附件</button> : null}</p>;
  return <figure>{kind === "image" ? <img src={resource.url} alt={caption || name} loading="lazy" />
    : kind === "video" ? <video src={resource.url} controls preload="metadata" aria-label={caption || name} />
    : kind === "audio" ? <audio src={resource.url} controls preload="metadata" aria-label={caption || name} />
    : <a href={resource.url} download={resource.managed ? name : undefined} rel="noopener noreferrer">{caption || name}</a>}
    {caption ? <figcaption>{caption}</figcaption> : null}</figure>;
}

export function ManagedContentLink({ reference, fallback, children }: { reference?: string; fallback: string | null; children: ReactNode }) {
  const resource = useContentResource(reference, fallback);
  const links = useContext(ContentLinkContext);
  return resource.url ? <a href={links?.resolve(resource.url) ?? resource.url} onClick={links?.onClick ? (event) => links.onClick?.(event, resource.url!) : undefined} download={resource.managed || undefined} rel="noopener noreferrer">{children}</a>
    : <span>{children}{resource.loading ? <small>（附件加载中…）</small> : resource.canRetry ? <button type="button" onClick={resource.retry}>重新加载附件</button> : null}</span>;
}
