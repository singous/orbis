import type { ReactNode } from "react";

const readStatusStyles = {
  document: {
    root: "mx-auto max-w-190 px-8 py-16",
    title: "mb-4 text-[1.5rem] font-semibold",
    message: "mb-6 leading-[1.7] text-(--ob-share-muted-foreground)",
  },
  reader: {
    root: "site-reader-status grid min-h-[70vh] content-center justify-items-center gap-4 bg-card p-[30px] text-foreground",
    title: "m-0 text-[length:var(--ob-prose-title-size)] font-[680]",
    message: "m-0 text-[length:var(--ob-prose-body-size)] text-(--ob-reader-status-muted)",
  },
};

type ReadStatusProps = {
  as?: "main" | "section" | "div";
  appearance?: keyof typeof readStatusStyles;
  title: ReactNode;
  pending?: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
};

export function ReadStatus({ as: Root = "section", appearance = "document", title, pending, message, action }: ReadStatusProps) {
  const styles = readStatusStyles[appearance];
  return <Root className={styles.root}>
    <h1 className={styles.title}>{title}</h1>
    {pending ?? <>{message !== undefined ? <p className={styles.message}>{message}</p> : null}{action}</>}
  </Root>;
}
