import { buttonVariants } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";

export const workspaceFunctionMenuClassName = "workspace-function-menu flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-[9px] pb-2.5 [&>.document-tree-panel]:p-0";
export const workspaceFunctionNavClassName = "workspace-function-nav flex flex-col gap-[3px]";
export function workspaceFunctionLinkClassName({ isActive = false, className }: { isActive?: boolean; className?: string } = {}) {
  return cn(buttonVariants({ variant: isActive ? "secondary" : "ghost" }), "workspace-function-link w-full min-w-0 justify-start whitespace-normal", className);
}
export const workspaceNavFooterClassName = "workspace-nav-footer mt-auto pt-[25px]";
export const workspaceEditionClassName = "workspace-edition mt-[9px] block border-t border-border px-2.5 pt-[15px] pb-1 text-xs tracking-[0.015em] text-(--muted-foreground)";
