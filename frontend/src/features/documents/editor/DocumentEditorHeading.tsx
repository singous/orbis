import { Input } from "@orbis/ui/input";
import { BookOpen, ChevronRight } from "@orbis/ui/icons";
import { Link } from "react-router-dom";
import { formatNotebookUpdateTime } from "../notebook-update-time";
import { documentBreadcrumbClassName, editorTitleClassName } from "./document-chrome";

export function DocumentBreadcrumb({ notebookId, notebookTitle = "笔记本", title }: {
  notebookId?: string;
  notebookTitle?: string;
  title: string;
}) {
  return (
    <nav className={documentBreadcrumbClassName} aria-label="文档位置">
      <Link to={notebookId ? `/collections/${notebookId}` : "/documents"} title={notebookTitle}>
        <BookOpen aria-hidden="true" size={15} /><span>{notebookTitle}</span>
      </Link>
      <ChevronRight aria-hidden="true" size={13} />
      <span aria-current="page" title={title}>{title}</span>
    </nav>
  );
}

export function DocumentEditorHeading({ title, updatedAt, description, readOnly, onTitleChange }: {
  title: string;
  updatedAt?: number;
  description?: string;
  readOnly?: boolean;
  onTitleChange?: (title: string) => void;
}) {
  return (
    <>
      <h1 className="sr-only">{title || "无标题"}</h1>
      <p className="mb-1 text-xs text-muted-foreground">块文档</p>
      <Input aria-label="文档标题" className={editorTitleClassName} placeholder="无标题" value={title} readOnly={readOnly || !onTitleChange}
        onChange={event => onTitleChange?.(event.target.value)} />
      <div className="mb-7 mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {updatedAt !== undefined ? <time dateTime={new Date(updatedAt).toISOString()}>{formatNotebookUpdateTime(updatedAt)} 更新</time> : null}
        {updatedAt !== undefined && description ? <span aria-hidden="true">·</span> : null}
        {description ? <span>{description}</span> : null}
      </div>
    </>
  );
}
