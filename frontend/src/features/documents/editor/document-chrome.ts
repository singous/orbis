/** Documents and sheets share the same responsive location and action row. */
export const documentBreadcrumbClassName = "document-breadcrumb flex min-w-0 items-center gap-[9px] text-xs max-[768px]:gap-[5px] [&_a]:flex [&_a]:min-w-0 [&_a]:max-w-[42%] [&_a]:items-center [&_a]:gap-[7px] [&_a]:text-(--muted-foreground) [&_a:hover]:text-foreground max-[768px]:[&_a]:max-w-[36%] [&_svg]:flex-none [&_svg]:text-(--muted-foreground) max-[768px]:[&_a>svg]:hidden [&_span]:truncate [&>span]:min-w-0 [&>span]:font-medium [&>span]:text-foreground";
export const documentHeaderActionsClassName = "document-header-actions flex items-center gap-1.5 max-[768px]:gap-0.5";
export const documentHeaderDividerClassName = "document-header-divider mr-[3px] h-4 w-px bg-border max-[768px]:hidden";
export const documentCommentTriggerClassName = "document-comment-trigger max-[768px]:w-7 max-[768px]:px-0 max-[768px]:[&>span]:hidden";

/** 正文起点取整页居中的位置，大纲只占用右侧的可用宽度。 */
export const editorCanvasClassName = [
  "editor-canvas w-full max-w-(--editor-canvas-max-width) justify-self-center bg-transparent pt-2 min-[1025px]:pt-10",
  "[--editor-body-width:1120px] [--editor-canvas-max-width:calc(var(--editor-body-width)+2*var(--editor-content-gutter))]",
  "min-[1025px]:in-[.editor-layout]:[--editor-canvas-start:max(0px,calc((100cqi-var(--editor-canvas-max-width))/2))] min-[1025px]:in-[.editor-layout]:ms-(--editor-canvas-start) min-[1025px]:in-[.editor-layout]:justify-self-start min-[1025px]:in-[.editor-layout]:max-w-[min(var(--editor-canvas-max-width),calc(100%-var(--editor-canvas-start)))]",
  "[--ob-prose-body-size:15px] [--ob-prose-h2-size:24px] [--editor-content-gutter:calc(2*var(--ob-control-height-sm)+.75rem)] min-[1025px]:[--editor-content-gutter:48px] pointer-coarse:[--editor-content-gutter:calc(2*var(--ob-control-height-touch)+.75rem)]",
  "[&>:not(.editor-title)]:mx-(--editor-content-gutter) max-[1024px]:pt-6 max-[1024px]:pb-16 max-[641px]:pb-[52px] max-[641px]:[&>:not(.editor-title)]:mx-5 [@media(max-width:640px)]:[&:has(.orbis-tiptap)>:not(.editor-title)]:ml-(--editor-content-gutter) [@media(max-width:640px)]:[&:has(.orbis-tiptap)>.editor-title]:pl-(--editor-content-gutter)",
].join(" ");
export const editorTitleClassName = "orbis-embedded-input editor-title h-12 w-full rounded-none bg-transparent font-semibold text-(--ob-document-heading-ink) tracking-tight text-[32px] md:text-[32px] px-(--editor-content-gutter) max-[641px]:px-5";
