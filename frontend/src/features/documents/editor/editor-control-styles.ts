import { cva } from "class-variance-authority";

/** Editor controls keep their layout in the editor and share native interaction colors. */
export const editorControlItemVariants = cva("bg-transparent [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true],[aria-selected=true])]:bg-(--ob-item-hover-bg) [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true],[aria-selected=true])]:text-[color:var(--ob-editor-item-foreground,var(--ob-item-foreground))] [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true],[aria-selected=true])_svg]:text-inherit", {
  variants: {
    surface: {
      toolbar: "text-(--ob-page-muted-foreground) [&:hover]:bg-(--ob-item-hover-bg) [&:hover]:text-ob-foreground",
      menu: "text-ob-foreground",
      "block-menu": "text-ob-foreground [&:hover]:bg-(--ob-item-hover-bg)",
    },
    tone: { danger: "block-action-danger text-(--ob-page-danger) [--ob-editor-item-foreground:var(--ob-page-danger)]" },
  },
  defaultVariants: { surface: "menu" },
});
export const editorToolbarControlClassName = editorControlItemVariants({ surface: "toolbar" });
export const editorMenuItemClassName = editorControlItemVariants();
export const blockMenuItemClassName = editorControlItemVariants({ surface: "block-menu" });
