import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Note, Notebook } from "@/shared/api/schemas";
import { formatDate } from "@/shared/format/date";
import { WorkbenchResourceLink } from "@/shared/ui/WorkbenchResourceLink";
import { NotebookIcon } from "./NotebookIcon";
import { DocumentKindIcon } from "./DocumentKindIcon";
import { DocumentLink } from "./DocumentLink";
import sand from "./assets/notebook-cover-sand.svg";
import sage from "./assets/notebook-cover-sage.svg";
import stone from "./assets/notebook-cover-stone.svg";
import moss from "./assets/notebook-cover-moss.svg";
import sky from "./assets/notebook-cover-sky.svg";

type NotebookCardProps = { notebook: Notebook; noteCount?: number; actions?: ReactNode } & (
  | { variant: "collection"; footer?: ReactNode }
  | { variant: "overview"; recent?: readonly Note[]; indexLoading?: boolean }
);

const covers = [
  { artwork: sand, surface: "bg-(--ob-book-cover-sand)" },
  { artwork: sage, surface: "bg-(--ob-book-cover-sage)" },
  { artwork: stone, surface: "bg-(--ob-book-cover-stone)" },
  { artwork: moss, surface: "bg-(--ob-book-cover-moss)" },
  { artwork: sky, surface: "bg-(--ob-book-cover-sky)" },
];

export function NotebookCard(props: NotebookCardProps) {
  const { notebook, noteCount, actions } = props;
  const href = `/collections/${notebook.id}`;
  if (props.variant === "collection") return (
    <article className="workbench-collection-card flex min-h-24 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-[5px] rounded-xl border border-border bg-card py-[18px] ps-5 pe-[15px] shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none max-[560px]:p-4">
      <WorkbenchResourceLink appearance="inline" to={href} icon={<NotebookIcon icon={notebook.icon} />} title={notebook.title} caption={noteCount !== undefined ? `${noteCount} 篇文档 · 更新于 ${formatDate(notebook.updated_at_ms)}` : `更新于 ${formatDate(notebook.updated_at_ms)}`} className="workbench-collection-link flex-1 gap-[15px]" />
      <div className="workbench-collection-actions flex shrink-0 items-center gap-0 max-[1150px]:basis-full max-[1150px]:justify-end max-[850px]:basis-auto max-[560px]:basis-full">{actions}</div>
      {props.footer ? <div className="workbench-collection-footer mt-[3px] basis-full">{props.footer}</div> : null}
    </article>
  );

  // The same notebook keeps its cover across sections, reordering and visits.
  const cover = covers[Number.parseInt(notebook.id.slice(-8), 16) % covers.length];
  return (
    <article className="notebook-overview-card min-h-[280px] min-w-0 rounded-xl bg-(--ob-notebook-card) shadow-md transition-shadow hover:shadow-lg motion-reduce:transition-none">
      <Link to={href} title={notebook.title} className={`notebook-overview-card-link relative isolate flex h-[139px] flex-col items-start justify-between overflow-hidden rounded-t-xl border-s-[10px] border-(--ob-book-spine) py-[17px] ps-4 pe-3 text-(--ob-book-cover-ink) focus-ring focus-visible:-outline-offset-2 ${cover.surface}`}>
        <img src={cover.artwork} alt="" className="pointer-events-none absolute inset-y-0 end-0 -z-10 h-full w-[min(48%,112px)] object-cover object-left" />
        <NotebookIcon icon={notebook.icon} size="sm" className="size-5 rounded-none bg-transparent text-inherit [&>svg]:size-5" />
        <h3 className="line-clamp-2 max-w-full [font-family:var(--ob-book-cover-font)] text-2xl leading-tight font-semibold wrap-anywhere">{notebook.title}</h3>
      </Link>
      <div className="space-y-1 px-3.5 pt-2.5 pb-3">
        <div className="flex min-h-6 items-center justify-between gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">最近更新{noteCount === undefined ? "" : ` · ${noteCount} 项`}</span>
          {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
        </div>
        {props.recent?.length ? <ul className="m-0 grid list-none gap-1 p-0">{props.recent.map(note =>
          <li key={note.id} className="min-w-0"><DocumentLink noteId={note.id} to={`/documents/${note.id}`} title={note.title} className="flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm px-0.5 text-xs hover:bg-sidebar-accent">
            <DocumentKindIcon note={note} size={13} /><span className="min-w-0 flex-1 truncate">{note.title}</span>
            <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={new Date(note.updated_at_ms).toISOString()}>{formatDate(note.updated_at_ms)}</time>
          </DocumentLink></li>,
        )}</ul> : <p className="px-0.5 py-2 text-xs text-muted-foreground">{props.indexLoading ? "正在读取最近更新…" : noteCount === 0 ? "还没有文档" : "暂无最近更新"}</p>}
      </div>
    </article>
  );
}
