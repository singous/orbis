import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Note, Notebook } from "@/shared/api/schemas";
import { formatNotebookEditDay } from "./notebook-update-time";
import { NotebookIcon } from "./NotebookIcon";
import { DocumentKindIcon } from "./DocumentKindIcon";
import { DocumentLink } from "./DocumentLink";
import sand from "./assets/notebook-cover-sand.svg?no-inline";
import sage from "./assets/notebook-cover-sage.svg?no-inline";
import stone from "./assets/notebook-cover-stone.svg?no-inline";
import moss from "./assets/notebook-cover-moss.svg?no-inline";
import sky from "./assets/notebook-cover-sky.svg?no-inline";

type NotebookCardProps = {
  notebook: Notebook;
  noteCount?: number;
  actions?: ReactNode;
  recent?: readonly Note[];
  indexLoading: boolean;
};

const covers = [
  { artwork: sand, surface: "bg-(--ob-book-cover-sand)" },
  { artwork: sage, surface: "bg-(--ob-book-cover-sage)" },
  { artwork: stone, surface: "bg-(--ob-book-cover-stone)" },
  { artwork: moss, surface: "bg-(--ob-book-cover-moss)" },
  { artwork: sky, surface: "bg-(--ob-book-cover-sky)" },
];

export function NotebookCard({ notebook, noteCount, actions, recent, indexLoading }: NotebookCardProps) {
  const href = `/collections/${notebook.id}`;
  const now = Date.now();

  // The same notebook keeps its cover across sections, reordering and visits.
  const cover = covers[Number.parseInt(notebook.id.slice(-8), 16) % covers.length];
  return (
    <article className="notebook-overview-card min-h-[280px] min-w-0 rounded-xl bg-(--ob-notebook-card) shadow-md transition-shadow hover:shadow-lg motion-reduce:transition-none">
      <Link to={href} title={notebook.title} className={`notebook-overview-card-link relative isolate flex h-[139px] flex-col items-start justify-between overflow-hidden rounded-t-xl border-s-[10px] border-(--ob-book-spine) py-[17px] ps-4 pe-3 text-(--ob-book-cover-ink) focus-ring focus-visible:-outline-offset-2 ${cover.surface}`}>
        <img src={cover.artwork} alt="" className="pointer-events-none absolute inset-y-0 end-0 -z-10 h-full w-[min(48%,112px)] object-cover object-left" />
        <NotebookIcon icon={notebook.icon} size="sm" className="size-5 rounded-none bg-transparent text-inherit [&>svg]:size-5" />
        <h3 className="line-clamp-2 max-w-full [font-family:var(--ob-book-cover-font)] text-2xl leading-tight font-semibold wrap-anywhere">{notebook.title}</h3>
      </Link>
      <div className="space-y-2 px-4 pt-2 pb-3.5">
        <div className="flex min-h-6 items-center justify-between gap-1 text-[11px] text-muted-foreground">
          <span className="truncate">最近更新{noteCount === undefined ? null : <span className="sr-only"> · {noteCount} 项</span>}</span>
          {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
        </div>
        {recent?.length ? <ul className="m-0 grid list-none gap-2 p-0">{recent.map(note =>
          <li key={note.id} className="min-w-0"><DocumentLink noteId={note.id} to={`/documents/${note.id}`} title={note.title} className="flex min-h-[23px] min-w-0 items-center gap-[7px] rounded-sm text-xs hover:bg-sidebar-accent [&_svg]:text-muted-foreground">
            <DocumentKindIcon note={note} size={13} /><span className="min-w-0 flex-1 truncate">{note.title}</span>
            <time className="shrink-0 text-[10px] text-muted-foreground" dateTime={new Date(note.updated_at_ms).toISOString()}>{formatNotebookEditDay(note.updated_at_ms, now)}</time>
          </DocumentLink></li>,
        )}</ul> : <p className="px-0.5 py-2 text-xs text-muted-foreground">{indexLoading ? "正在读取最近更新…" : noteCount === 0 ? "还没有文档" : "暂无最近更新"}</p>}
      </div>
    </article>
  );
}
