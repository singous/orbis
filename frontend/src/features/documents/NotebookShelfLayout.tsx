import type { ReactNode } from "react";
import { Button } from "@orbis/ui/button";
import { FolderPlus, Plus } from "../../shared/ui/icons";
import { PageHeader } from "../../shared/ui/PageHeader";

export const notebookShelfGridClassName = "notebook-overview-grid grid grid-cols-4 gap-[18px] @max-[839px]/notebook-shelf:grid-cols-3 @max-[620px]/notebook-shelf:grid-cols-2 @max-[400px]/notebook-shelf:grid-cols-1";

export function NotebookShelfLayout({ description, actions, children }: { description: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="notebook-overview min-h-full bg-card">
      <div className="mx-auto w-full max-w-[1440px] px-[clamp(20px,3.25vw,44px)] pt-[37px] pb-10 max-[640px]:pt-6">
        <PageHeader className="mb-8 border-0 pb-0 max-[641px]:pb-0 [&_.page-actions]:items-center" title="我的文档" description={description} actions={actions} />
        {children}
      </div>
    </div>
  );
}

export function NotebookShelfActions({ onCreateGroup, onCreateNotebook }: { onCreateGroup?: () => void; onCreateNotebook?: () => void }) {
  return <>
    <Button variant="secondary" size="lg" className="gap-[7px] px-3.5 text-[13px] font-semibold" disabled={!onCreateGroup} onClick={onCreateGroup}><FolderPlus aria-hidden="true" />新建分组</Button>
    <Button size="lg" className="gap-[7px] px-3.5 text-[13px] font-semibold" disabled={!onCreateNotebook} onClick={onCreateNotebook}><Plus aria-hidden="true" />新建笔记本</Button>
  </>;
}

export function NotebookShelfCountPlaceholder() {
  return <span className="invisible" aria-hidden="true">笔记本与分组</span>;
}
