import type { ReactNode } from "react";

export type PageContainerProps = {
  /** Small uppercase label above the title, e.g. 文档中心. */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned header actions (buttons, links). */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Canonical page geometry for workspace pages: one centered column with a
 * consistent header (eyebrow / title / description / actions). Pages should
 * not hand-roll their own max-width wrapper or header markup.
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
