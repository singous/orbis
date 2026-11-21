import type { ReactNode } from "react";
import { BookOpen } from "@orbis/ui/icons";

export function NotebookCoverIdentity({ icon, title, metadata }: { icon: ReactNode; title: string; metadata: ReactNode }) {
  return (
    <div className="notebook-identity flex min-w-0 max-w-full flex-[1_1_260px] items-center gap-4 max-[600px]:basis-full max-[600px]:gap-3.5">
      {icon}
      <div className="notebook-identity-copy grid min-w-0 gap-1.5">
        <h1 className="page-title m-0 truncate text-[28px] font-semibold leading-10 tracking-[-.02em] wrap-anywhere text-foreground max-[600px]:text-[24px] max-[600px]:leading-8" title={title}>{title}</h1>
        <p className="page-description notebook-home-stats m-0 flex max-w-[46rem] flex-wrap items-baseline gap-x-1.5 text-xs leading-5 text-muted-foreground" role="status" aria-label="文档统计">{metadata}</p>
      </div>
    </div>
  );
}

export function NotebookCoverPending({ metadata = "正在读取目录…" }: { metadata?: ReactNode }) {
  return <NotebookCoverIdentity title="正在加载…" metadata={metadata}
    icon={<span className="flex h-16 w-[54px] shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground max-[600px]:size-11"><BookOpen aria-hidden="true" size={25} /></span>}
  />;
}
