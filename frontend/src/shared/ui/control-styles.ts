import { cva } from "class-variance-authority";

export const controlFeedbackClassName = "touch-manipulation transition-[color,background-color,border-color,box-shadow,transform] duration-(--ob-motion-feedback) ease-(--ob-ease-out) motion-reduce:transition-none motion-reduce:ease-[ease]";

export const controlTones = {
  primary: "bg-ob-primary text-ob-primary-foreground enabled:hover:bg-ob-components-button-primary-bg-hover",
  secondary: "bg-ob-secondary text-ob-primary enabled:hover:bg-ob-components-control-secondary-bg-hover",
  tertiary: "bg-ob-secondary text-ob-foreground enabled:hover:bg-ob-components-control-secondary-bg-hover",
  ghost: "bg-transparent text-ob-foreground enabled:hover:bg-ob-secondary",
  outline: "border border-ob-border bg-transparent text-ob-foreground enabled:hover:bg-ob-secondary",
  danger: "bg-ob-destructive text-ob-destructive-foreground enabled:hover:bg-ob-components-control-danger-bg-hover",
  "danger-soft": "bg-ob-destructive/10 text-ob-destructive enabled:hover:bg-ob-destructive/20",
};

// 网格行高由视图控制，粗指针只放大网格外的普通操作。
export const domainTouchTargets = "pointer-coarse:[&:not(:where(.sheet-cell_*,.dt-grid-cell_*))]:min-h-(--ob-control-height-touch) pointer-coarse:[&:not(:where(.sheet-cell_*,.dt-grid-cell_*))]:min-w-(--ob-control-height-touch)";

export const compatibleButtonVariants = cva("button ui-button relative isolate inline-flex w-fit shrink-0 items-center justify-center gap-2 rounded-ob-xl border-0 [&>svg]:-mx-0.5 [&>svg]:size-4.5 [&>svg]:shrink-0 text-sm font-medium whitespace-nowrap " + controlFeedbackClassName + " " + domainTouchTargets, {
  variants: {
    variant: { primary: `button--primary ${controlTones.primary}`, secondary: `button--secondary ${controlTones.secondary}`, ghost: `button--ghost ${controlTones.ghost}`, danger: `button--danger ${controlTones.danger}` },
    size: { sm: "button--sm ui-button--sm h-(--ob-control-height-sm) min-h-(--ob-control-height-sm) px-2.5", md: "button--md ui-button--md h-(--ob-control-height-md) min-h-(--ob-control-height-md) px-3" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

/** Native icon actions share compact geometry; the caller keeps its own artwork size. */
export const iconActionVariants = cva("icon-button inline-grid size-(--ob-control-height-sm) shrink-0 place-items-center text-(--ob-page-muted-foreground) transition-[background-color,color] duration-(--ob-motion-feedback) ease-[ease] disabled:cursor-not-allowed disabled:opacity-[0.28] data-disabled:opacity-[0.28] [&:hover]:bg-(--ob-item-hover-bg) [&:hover]:text-ob-foreground [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true])]:bg-(--ob-item-hover-bg) [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true])]:text-[color:var(--ob-icon-action-foreground,var(--ob-item-foreground))] [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true])_svg]:text-inherit", {
  variants: { tone: { danger: "[--ob-icon-action-foreground:var(--ob-page-danger)]" } },
});

export const textActionClassName = "text-action inline-flex h-(--ob-control-height-md) min-h-(--ob-control-height-md) shrink-0 items-center [justify-content:center] [gap:var(--orbis-space-2)] border-transparent px-3 [font:var(--orbis-weight-action)_var(--orbis-text-ui-size)/var(--orbis-text-ui-leading)_var(--ob-font-sans)] whitespace-nowrap text-ob-muted-foreground [&:hover]:bg-(--ob-item-hover-bg) [&:hover]:text-ob-foreground [&>svg]:size-[1.125rem] [&>svg]:shrink-0";
