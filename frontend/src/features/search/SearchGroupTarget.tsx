import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../shared/ui/Button";
import { LoadingState } from "../../shared/ui/LoadingState";

import { NotebookIcon } from "../documents/NotebookIcon";
import { useNotebooks } from "../documents/queries";
import { useSearchResource } from "./use-search-resource";

/** A group outside the loaded list still opens its authorized, complete notebook list. */
export function SearchGroupTarget({ id, canCreate, onCreate }: { id: string; canCreate: boolean; onCreate: () => void }) {
  const group = useSearchResource("group", id, "active");
  const notebooks = useNotebooks(id);
  const target = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!group.data) return;
    target.current?.focus({ preventScroll: true });
    target.current?.scrollIntoView?.({ block: "nearest" });
  }, [group.data?.id]);
  if (group.isPending) return <LoadingState label="正在定位分组…" />;
  if (group.isError) return null;
  if (!group.data) return null;
  return <section ref={target} tabIndex={-1} className="workbench-collection-group" aria-label={`搜索定位的分组 ${group.data.title}`}>
    <div className="section-heading"><div><h2>{group.data.title}</h2><p>{group.data.location}</p></div>{canCreate ? <Button onClick={onCreate}>新建笔记本</Button> : null}</div>
    {notebooks.isLoading ? <LoadingState label="正在读取分组笔记本…" /> : null}

    <div className="workbench-document-list">{notebooks.data?.items.map(notebook => <Link key={notebook.id} to={`/collections/${notebook.id}`} className="workbench-document-row"><NotebookIcon icon={notebook.icon} size="sm" /><span>{notebook.title}</span></Link>)}</div>
    {!notebooks.isLoading && !notebooks.isError && !notebooks.data?.items.length ? <p>这个分组中还没有笔记本。</p> : null}
  </section>;
}
