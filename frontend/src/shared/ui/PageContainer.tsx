import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";

export { pageActionsClassName } from "./PageHeader";

export const pageBaseColumnClassName = "mx-auto w-full max-w-[1360px] px-[clamp(28px,4.8vw,76px)] pt-[46px] pb-[72px]";
export const pageColumnClassName = `page-container ${pageBaseColumnClassName} max-[1024px]:px-7 max-[1024px]:pt-8 max-[1024px]:pb-[60px] max-[641px]:px-5 max-[641px]:pt-6 max-[641px]:pb-12 [&_time]:[font-family:var(--ob-font-mono)] [&_time]:tracking-[-0.02em]`;

export type PageContainerProps = {
  /** Optional section context above the title, e.g. 文档中心. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned header actions (buttons, links). */
  actions?: ReactNode;
  headerClassName?: string;
  children: ReactNode;
};

/**
 * Shared workbench column with a spacious, quiet title row.
 */
export function PageContainer({ eyebrow, title, description, actions, headerClassName, children }: PageContainerProps) {
  return (
    <div className={pageColumnClassName}>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} className={headerClassName} />
      {children}
    </div>
  );
}
