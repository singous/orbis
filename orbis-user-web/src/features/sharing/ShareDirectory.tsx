import { Link } from "react-router-dom";
import type { PublicShare } from "./api";

export function ShareDirectory({
  manifest,
  token,
  selectedId,
}: {
  manifest: PublicShare;
  token: string;
  selectedId?: string;
}) {
  const children = new Map<string | null, PublicShare["items"]>();
  for (const item of manifest.items) {
    const siblings = children.get(item.parent_id) ?? [];
    siblings.push(item);
    children.set(item.parent_id, siblings);
  }
  const branch = (parentId: string | null) => (
    <ul>
      {(children.get(parentId) ?? []).map((item) => (
        <li key={item.id}>
          <Link
            aria-current={item.id === selectedId ? "page" : undefined}
            to={`/share/${encodeURIComponent(token)}/${item.id}`}
          >
            {item.title}
          </Link>
          {children.has(item.id) ? branch(item.id) : null}
        </li>
      ))}
    </ul>
  );
  return <nav aria-label="分享文档目录">{branch(null)}</nav>;
}
