import { cva } from "class-variance-authority";
import { navigationIconFeedbackClassName } from "./navigation-icon-styles";

export const workspaceFunctionMenuClassName = "workspace-function-menu flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-[9px] pb-2.5 [&>.document-tree-panel]:p-0";
export const workspaceFunctionNavClassName = "workspace-function-nav flex flex-col gap-[3px]";
export const workspaceFunctionLinkClassName = cva(navigationIconFeedbackClassName + " workspace-function-link ob-focus-ring flex min-h-(--ob-control-height-md) min-w-0 items-center gap-[9px] rounded-[7px] px-2.5 py-[7px] text-sm text-ob-foreground [&:is(:hover,:focus-visible)]:bg-(--ob-item-hover-bg) [&:is(:hover,:focus-visible)]:text-(--ob-item-foreground) [&:is(:hover,:focus-visible)_svg]:text-inherit focus-visible:outline-offset-[-2px] [&_svg]:flex-none", { variants: { isActive: { true: "is-active bg-(--ob-item-hover-bg) font-medium forced-colors:text-(--ob-item-foreground) [&_svg]:text-inherit" } } });
export const workspaceNavFooterClassName = "workspace-nav-footer mt-auto pt-[25px]";
export const workspaceEditionClassName = "workspace-edition mt-[9px] block border-t border-ob-workspace-divider px-2.5 pt-[15px] pb-1 text-ob-caption tracking-[0.015em] text-(--ob-page-muted-foreground)";
