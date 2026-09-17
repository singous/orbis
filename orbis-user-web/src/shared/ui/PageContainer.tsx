import type { ReactNode } from "react";

export type PageContainerProps = {
  /** Optional section context above the title, e.g. 文档中心. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned header actions (buttons, links). */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Shared workbench column with a quiet title row and a separating hairline.
 */
export function PageContainer({ eyebrow, title, description, actions, children }: PageContainerProps) {
  return (
    <div className="page-container">
      <header className="page-header">
        <div className="min-w-0">
          {eyebrow ? <div className="page-eyebrow">{eyebrow}</div> : null}
          <h1 className="page-title">{title}</h1>
          {description ? <p className="page-description">{description}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
