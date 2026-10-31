import { cva } from "class-variance-authority";

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

export const compatibleButtonVariants = cva("button ui-button relative isolate inline-flex w-fit shrink-0 items-center justify-center gap-2 rounded-ob-xl border-0 [&>svg]:-mx-0.5 [&>svg]:size-4.5 [&>svg]:shrink-0 text-sm font-medium whitespace-nowrap transition-colors duration-(--ob-motion-feedback) " + domainTouchTargets, {
  variants: {
    variant: { primary: `button--primary ${controlTones.primary}`, secondary: `button--secondary ${controlTones.secondary}`, ghost: `button--ghost ${controlTones.ghost}`, danger: `button--danger ${controlTones.danger}` },
    size: { sm: "button--sm ui-button--sm h-(--ob-control-height-sm) min-h-(--ob-control-height-sm) px-2.5", md: "button--md ui-button--md h-(--ob-control-height-md) min-h-(--ob-control-height-md) px-3" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});
