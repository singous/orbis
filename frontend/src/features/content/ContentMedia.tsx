import { ActionButton } from "../../shared/ui/ActionButton";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { FileContentContext } from "../files/FileContent";
import { parseFileReference } from "../files/managed-files";
import { useResourceVisibility } from "./use-resource-visibility";

export const ContentLinkContext = createContext<{
  resolve: (href: string) => string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
} | null>(null);

function useContentResource(reference: string | undefined, fallback: string | null, automatic = false) {
  const files = useContext(FileContentContext);
  const managed = Boolean(reference && parseFileReference(reference));
  const key = `${files?.scope ?? "public"}:${reference}`;
  const [result, setResult] = useState<{ key: string; url: string | null; failed: boolean } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const active = useRef(key);
  active.current = key;
  useEffect(() => {
    active.current = key;
    return () => { active.current = ""; };
  }, [key]);
  const request = useCallback(async () => {
    if (!managed || !files || !reference) return fallback;
    setPendingKey(key);
    try {
      const url = await files.resolve(reference);
      if (active.current !== key) return null;
      setResult({ key, url, failed: false });
      return url;
    } catch {
      if (active.current === key) setResult({ key, url: null, failed: true });
      return null;
    } finally {
      if (active.current === key) setPendingKey(null);
    }
  }, [managed, reference, files, key, fallback]);
  useEffect(() => { if (automatic) void request(); }, [automatic, request]);
  const current = result?.key === key ? result : null;
  return {
    url: managed ? current?.url ?? null : fallback,
    managed,
    available: managed ? Boolean(files) : Boolean(fallback),
    loading: pendingKey === key,
    canRetry: managed && Boolean(files) && current?.failed,
    request,
  };
}

function downloadResource(url: string, name = "") {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener noreferrer";
  link.click();
}

export function ContentMedia({ kind, reference, fallback, name, caption, previewWidth }: {
  kind: "image" | "video" | "audio" | "file";
  reference?: string;
  fallback: string | null;
  name: string;
  caption?: string;
  previewWidth?: unknown;
}) {
  const visibility = useResourceVisibility(reference ?? "", kind === "image");
  const resource = useContentResource(reference, fallback, visibility.visible);
  const requestResource = async () => {
    const url = await resource.request();
    if (url && kind === "file") downloadResource(url, name);
  };
  const width = typeof previewWidth === "number" && Number.isFinite(previewWidth) && previewWidth > 0 ? previewWidth : undefined;
  let content: ReactNode;
  if (resource.url) {
    content = kind === "image" ? <img src={resource.url} alt={caption || name} loading="lazy" />
      : kind === "video" ? <video src={resource.url} controls preload="metadata" aria-label={caption || name} />
      : kind === "audio" ? <audio src={resource.url} controls preload="metadata" aria-label={caption || name} />
      : <a href={resource.url} download={resource.managed ? name : undefined} rel="noopener noreferrer">{caption || name}</a>;
  } else {
    const status = resource.loading ? `${name}（正在加载…）`
      : resource.canRetry ? <>{name}<ActionButton type="button" onClick={() => void requestResource()}>重新加载附件</ActionButton></>
      : !resource.available ? `${name}（资源不可用）`
      : kind === "image" ? `${name}（等待进入可见区域）`
      : <ActionButton type="button" onClick={() => void requestResource()}>{kind === "file" ? "下载" : "加载"}{caption || name}</ActionButton>;
    content = <p className="content-unavailable">{status}</p>;
  }
  return <figure ref={visibility.ref as RefObject<HTMLElement>} style={kind === "image" || kind === "video" ? { width, maxWidth: "100%" } : undefined}>
    {content}
    {caption ? <figcaption>{caption}</figcaption> : null}
  </figure>;
}

export function ManagedContentImage({ reference, fallback, alt, unavailable }: {
  reference?: string;
  fallback: string | null;
  alt: string;
  unavailable: ReactNode;
}) {
  const visibility = useResourceVisibility(reference ?? "");
  const resource = useContentResource(reference, fallback, visibility.visible);
  return <span ref={visibility.ref as RefObject<HTMLSpanElement>}>{resource.url ? <img src={resource.url} alt={alt} /> : unavailable}</span>;
}

export function ManagedContentLink({ reference, fallback, children, className }: { reference?: string; fallback: string | null; children: ReactNode; className?: string }) {
  const resource = useContentResource(reference, fallback);
  const links = useContext(ContentLinkContext);
  return resource.url ? <a className={className} href={links?.resolve(resource.url) ?? resource.url} onClick={links?.onClick ? (event) => links.onClick?.(event, resource.url!) : undefined} download={resource.managed || undefined} rel="noopener noreferrer">{children}</a>
    : resource.managed && resource.available ? <ActionButton type="button" className={className} disabled={resource.loading} onClick={async () => { const url = await resource.request(); if (url) downloadResource(url); }}>{children}{resource.loading ? "（附件加载中…）" : resource.canRetry ? "（重试下载）" : ""}</ActionButton> : <span className={className}>{children}</span>;
}
