import { FilePlus2, FileWarning, RefreshCcw } from "../../shared/ui/icons";
import { Link } from "react-router-dom";

import type { SiteChangePage, SiteSources } from "./schemas";

function ChangeGroup({ label, items, icon: Icon }: { label: string; items: SiteChangePage[]; icon: typeof FilePlus2 }) {
  return <section className="min-h-[90px] rounded-[10px] border border-border px-3 py-[11px]">
    <header className="mb-2 flex items-center gap-[7px] text-xs text-muted-foreground"><Icon aria-hidden="true" size={16} /><strong>{label} {items.length}</strong></header>
    {items.length ? <ul className="grid gap-[5px]">{items.map((item, index) => <li className="flex min-w-0 justify-between gap-2 text-xs" key={`${item.note_id ?? item.slug}-${index}`}>
      {item.note_id ? <Link className="truncate" to={`/documents/${item.note_id}`}>{item.title}</Link> : <span className="truncate">{item.title}</span>}
      <code className="text-muted-foreground">/{item.slug}</code>
    </li>)}</ul> : <p className="text-xs text-muted-foreground">无</p>}
  </section>;
}

export function SiteChanges({ changes }: { changes: SiteSources["changes"] }) {
  return <div className="grid grid-cols-1 gap-2.5 min-[721px]:grid-cols-3" aria-label="待发布变化">
    <ChangeGroup label="新增" items={changes.added} icon={FilePlus2} />
    <ChangeGroup label="修改" items={changes.modified} icon={RefreshCcw} />
    <ChangeGroup label="移除" items={changes.removed} icon={FileWarning} />
  </div>;
}
