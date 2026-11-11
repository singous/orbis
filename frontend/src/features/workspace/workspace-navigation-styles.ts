import { buttonVariants } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";

export const workspaceFunctionMenuClassName = "workspace-function-menu flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-[9px] pb-2.5 [&>.document-tree-panel]:p-0";
export const workspaceFunctionNavClassName = "workspace-function-nav flex flex-col gap-[3px]";
export function workspaceFunctionLinkClassName({ isActive = false, className }: { isActive?: boolean; className?: string } = {}) {
  return cn(buttonVariants({ variant: isActive ? "secondary" : "ghost" }), "workspace-function-link w-full min-w-0 justify-start whitespace-normal in-data-[document-navigation=true]:min-h-9 in-data-[document-navigation=true]:gap-2.5 in-data-[document-navigation=true]:rounded-md", isActive && "in-data-[document-navigation=true]:bg-sidebar-accent in-data-[document-navigation=true]:text-foreground in-data-[document-navigation=true]:hover:bg-sidebar-accent", className);
}
export const workspaceNavFooterClassName = "workspace-nav-footer mt-auto pt-[25px]";
export const workspaceEditionClassName = "workspace-edition mt-[9px] block border-t border-border px-2.5 pt-[15px] pb-1 text-xs tracking-[0.015em] text-(--muted-foreground)";
export const workspaceMenuPanelClassName = "w-(--ob-menu-width) max-w-[calc(100vw-2rem)] gap-1 rounded-xl p-2";
export const workspaceMenuRowClassName = "min-h-(--ob-menu-row-height) min-w-0 gap-2.5 rounded-md px-3 text-sm font-normal";
