import { buttonVariants } from "@orbis/ui/button";

export const editorToolbarControlClassName = "shrink-0";
export const editorMenuItemClassName = "justify-start";
export const editorMoreMenuItemClassName = "w-full justify-start";
export const blockMenuItemClassName = "w-full justify-start";

export const editorToolbarClassName = "orbis-tiptap-toolbar sticky top-0 z-4 mb-[21px] flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] border border-border bg-popover p-1.5 text-popover-foreground [box-shadow:var(--ob-editor-toolbar-shadow)] [scrollbar-width:thin] in-[.workspace-shell]:border-border [@media(max-width:700px)]:static [@media(max-width:700px)]:mx-0 [@media(max-width:700px)]:flex-wrap [@media(max-width:700px)]:gap-[3px] [@media(max-width:700px)]:overflow-visible in-[.document-format-host]:static in-[.document-format-host]:m-0 in-[.document-format-host]:min-h-[43px] in-[.document-format-host]:w-full in-[.document-format-host]:gap-[3px] in-[.document-format-host]:rounded-none in-[.document-format-host]:border-0 in-[.document-format-host]:border-none in-[.document-format-host]:border-current in-[.document-format-host]:bg-card in-[.document-format-host]:px-[18px] in-[.document-format-host]:py-[5px] in-[.document-format-host]:[box-shadow:none] [@media(max-width:700px)]:in-[.document-format-host]:flex-nowrap [@media(max-width:700px)]:in-[.document-format-host]:gap-px [@media(max-width:700px)]:in-[.document-format-host]:overflow-x-auto [@media(max-width:700px)]:in-[.document-format-host]:px-2 [@media(max-width:700px)]:in-[.document-format-host]:py-1";
export const editorToolbarDividerClassName = "orbis-tiptap-toolbar-divider mx-[3px] h-4.5 flex-none border-l border-border in-[.workspace-shell]:border-border";
export const editorInsertionMenuClassName = "orbis-tiptap-menu fixed z-50 m-0 grid max-h-[min(250px,calc(100dvh-32px))] w-[min(570px,calc(100vw-24px))] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-[3px] overflow-y-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground [box-shadow:var(--shadow-lg)] [@media(max-width:700px)]:grid-cols-2";
export const editorMoreMenuClassName = "editor-more-menu fixed z-50 grid min-w-[170px] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground [box-shadow:var(--shadow-lg)]";
export const editorNodeSettingsClassName = "doc-editor-settings absolute top-1 right-1 z-2";
export const editorNodeControlsClassName = "doc-editor-controls my-[9px] flex flex-wrap items-end gap-2.5 border-t border-(--reading-border) py-[9px] [font-family:inherit] [&_label]:m-0 [&_label]:grid [&_label]:min-w-[125px] [&_label]:flex-1 [&_label]:gap-[3px]";
export const editorNodeFieldClassName = "m-0 grid min-w-[125px] flex-1 gap-[3px]";
export const editorPaneButtonClassName = "flex-none cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-px pt-2.5 pb-[11px] [font:400_var(--ob-prose-body-size)/var(--ob-prose-body-leading)_var(--font-sans)] text-(--reading-muted) aria-selected:border-(--reading-accent) aria-selected:text-(--reading-accent)";
export const editorOutlineLinkClassName = "editor-outline-link h-auto w-full justify-start overflow-hidden text-start text-ellipsis whitespace-nowrap";
export const editorLoadMoreClassName = "document-load-more py-6 text-sm leading-5 text-(--muted-foreground)";
export const editorContentLoaderClassName = "editor-content-loader flex items-center gap-3 py-2.5 select-none";
export const editorContentLoaderButtonClassName = buttonVariants({ variant: "outline", size: "sm", className: "editor-content-loader-button" });
export const editorContentLoaderErrorClassName = "editor-content-loader-error text-[12px] text-destructive";
