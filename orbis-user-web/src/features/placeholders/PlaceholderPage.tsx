import { LibraryBig, Sparkles, type LucideIcon } from "lucide-react";

import { EmptyState } from "../../shared/ui/EmptyState";
import { Tag } from "../../shared/ui/Tag";
import { WorkspaceShell } from "../workspace/WorkspaceShell";

export type PlaceholderPageProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function PlaceholderPage({ title, description, icon: Icon }: PlaceholderPageProps) {
  return (
    <WorkspaceShell sectionTitle={title}>
      <div className="mx-auto max-w-[720px] px-5 py-16 lg:py-24">
        <EmptyState
          icon={<Icon aria-hidden="true" size={28} />}
          title={`${title}正在建设中`}
          description={description}
          action={<Tag tone="accent">即将上线</Tag>}
        />
      </div>
    </WorkspaceShell>
  );
}

export function KnowledgePlaceholderPage() {
  return (
    <PlaceholderPage
      title="知识库"
      icon={LibraryBig}
      description="文件与笔记快照将在这里完成入库和索引，提供全文检索、向量检索和基础问答能力。"
    />
  );
}

export function MemoryPlaceholderPage() {
  return (
    <PlaceholderPage
      title="记忆"
      icon={Sparkles}
      description="记忆中心将沉淀你的长期上下文，为创作和检索提供持续的背景支持。"
    />
  );
}
