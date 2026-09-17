import { FilePlus2, FileWarning, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";

import type { SiteChangePage, SiteSources } from "./schemas";

function ChangeGroup({ label, items, tone }: { label: string; items: SiteChangePage[]; tone: "added" | "modified" | "removed" }) {
  const Icon = tone === "added" ? FilePlus2 : tone === "modified" ? RefreshCcw : FileWarning;
  return <section className={`site-change-group ${tone}`}>
    <header><Icon aria-hidden="true" size={15} /><strong>{label} {items.length}</strong></header>
    {items.length ? <ul>{items.map((item, index) => <li key={`${item.note_id ?? item.slug}-${index}`}>
      {item.note_id ? <Link to={`/documents/${item.note_id}`}>{item.title}</Link> : <span>{item.title}</span>}
      <code>/{item.slug}</code>
    </li>)}</ul> : <p>无</p>}
  </section>;
}

export function SiteChanges({ changes }: { changes: SiteSources["changes"] }) {
  return <div className="site-changes" aria-label="待发布变化">
    <ChangeGroup label="新增" items={changes.added} tone="added" />
    <ChangeGroup label="修改" items={changes.modified} tone="modified" />
    <ChangeGroup label="移除" items={changes.removed} tone="removed" />
  </div>;
}
