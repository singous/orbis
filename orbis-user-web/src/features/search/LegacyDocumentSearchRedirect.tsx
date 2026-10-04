import { Navigate, useSearchParams } from "react-router-dom";

/** Preserve old bookmarks while keeping document-only search intentional. */
export function LegacyDocumentSearchRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set("type", "document");
  return <Navigate replace to={`/search?${next}`} />;
}
