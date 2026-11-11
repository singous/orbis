import { Button, buttonVariants } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@orbis/ui/popover";
import { ArrowLeft, Check, LibraryBig } from "@orbis/ui/icons";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { workspaceMenuPanelClassName, workspaceMenuRowClassName } from "../workspace/workspace-navigation-styles";
import { NotebookIcon } from "./NotebookIcon";
import { usePinnedNotebooks } from "./pinned-notebooks";
import { useNotebooks } from "./queries";

export function NotebookShortcuts({ notebookId }: { notebookId: string }) {
  const workspaceId = useStore(authStore, state => state.workspace?.id);
  const { isPinned } = usePinnedNotebooks(workspaceId);
  const [open, setOpen] = useState(false);
  const notebooks = useNotebooks(undefined, "active", { enabled: open });
  const pinned = notebooks.data?.items.filter(notebook => isPinned(notebook.id)) ?? [];
  const rowClass = cn(buttonVariants({ variant: "ghost" }), "w-full justify-start", workspaceMenuRowClassName);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger openOnHover delay={180} closeDelay={180} render={<Button variant="ghost" className="h-[60px] w-[52px] flex-col gap-1.5" aria-label="常用笔记本"><LibraryBig aria-hidden="true" className="size-[22px]" /><span className="text-[11px]">常用</span></Button>} />
      <PopoverContent aria-label="常用笔记本" className={cn(workspaceMenuPanelClassName, "max-h-(--available-height) overflow-auto")} side="right" align="start" sideOffset={2}>
        <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">常用笔记本</div>
        {pinned.map(notebook => <Link key={notebook.id} to={`/collections/${notebook.id}`} aria-current={notebook.id === notebookId ? "page" : undefined} onClick={() => setOpen(false)} className={cn(rowClass, notebook.id === notebookId && "bg-sidebar-accent hover:bg-sidebar-accent")}>
          <NotebookIcon icon={notebook.icon} size="sm" /><span className="min-w-0 flex-1 truncate">{notebook.title}</span>{notebook.id === notebookId ? <Check aria-hidden="true" /> : null}
        </Link>)}
        {!pinned.length ? <p className="px-3 py-2 text-xs text-muted-foreground">{notebooks.isLoading ? "正在读取笔记本…" : "还没有常用笔记本。"}</p> : null}
        <div className="h-px bg-border" aria-hidden="true" />
        <Link to="/documents" onClick={() => setOpen(false)} className={rowClass}><ArrowLeft aria-hidden="true" />返回我的文档</Link>
      </PopoverContent>
    </Popover>
  );
}
