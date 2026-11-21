import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "../../shared/ui/icons";
import { ListTree, Network } from "@orbis/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@orbis/ui/tabs";

export function NotebookHomeLayout({ groupName, identity, actions, notice, children }: {
  groupName?: string;
  identity: ReactNode;
  actions?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="notebook-home min-h-full w-full bg-(--ob-document-surface) p-7 max-[600px]:p-3">
      <nav className="mb-6 flex items-center gap-2 text-xs text-muted-foreground" aria-label="笔记本位置">
        <Link to="/documents" className="inline-flex items-center gap-2 rounded-sm hover:text-foreground"><ArrowLeft aria-hidden="true" size={14} />我的文档</Link>
        {groupName ? <><ChevronRight aria-hidden="true" size={12} /><span>{groupName}</span></> : null}
      </nav>
      <article className="min-h-[calc(100dvh-97px)] rounded-xl bg-card p-8 max-[600px]:p-5" aria-label="笔记本首页">
        <header className="notebook-page-header mb-7 flex flex-wrap items-start justify-between gap-4">
          {identity}
          {actions}
        </header>
        {notice}
        <section className="notebook-home-intro mb-7 space-y-3 py-5" aria-labelledby="notebook-welcome-heading">
          <h2 id="notebook-welcome-heading" className="text-[15px] font-medium">关于这个笔记本</h2>
          <p className="max-w-[46rem] text-[13px] leading-6 text-muted-foreground">笔记本就像一本书，让多篇文档结构化，方便知识的创作与沉淀。</p>
        </section>
        {children}
      </article>
    </div>
  );
}

export function NotebookHomeViews({ directory, mindMap }: { directory: ReactNode; mindMap?: ReactNode }) {
  return (
    <Tabs defaultValue="directory" className="gap-3.5 px-6 max-[600px]:px-0">
      <TabsList aria-label="笔记本视图" className="group-data-horizontal/tabs:h-[34px]">
        <TabsTrigger value="directory" className="h-7 px-2.5 text-xs data-active:bg-card"><ListTree aria-hidden="true" className="size-[14px]" />目录</TabsTrigger>
        <TabsTrigger value="mind-map" disabled={!mindMap} className="h-7 px-2.5 text-xs data-active:bg-card"><Network aria-hidden="true" className="size-[14px]" />脑图</TabsTrigger>
      </TabsList>
      <TabsContent value="directory">{directory}</TabsContent>
      {mindMap ? <TabsContent value="mind-map">{mindMap}</TabsContent> : null}
    </Tabs>
  );
}
