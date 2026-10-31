import { Button as Primitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import { Children, cloneElement, isValidElement, useId, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { controlFocus } from "../internal/focus";
import { resolveClassName } from "../internal/resolve-class-name";

const buttonVariants = cva(
  `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-ob-sm border border-transparent text-sm font-medium select-none touch-manipulation transition-colors duration-(--ob-motion-feedback) disabled:cursor-not-allowed data-disabled:opacity-50 ${controlFocus}`,
  {
    variants: {
      variant: {
        primary: "bg-ob-components-button-primary-bg text-ob-components-button-primary-text enabled:hover:bg-ob-components-button-primary-bg-hover",
        secondary: "border-ob-border bg-ob-card text-ob-foreground enabled:hover:bg-ob-accent",
        ghost: "bg-transparent text-ob-foreground enabled:hover:bg-ob-accent",
        danger: "bg-ob-destructive text-ob-destructive-foreground enabled:hover:opacity-90",
      },
      size: {
        sm: "min-h-(--ob-control-height-sm) px-3",
        md: "min-h-(--ob-control-height-md) px-3",
        lg: "min-h-(--ob-control-height-lg) px-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = Omit<ComponentProps<"button">, "className" | "style" | "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  className?: string | ((state: { disabled: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement<ComponentProps<"button">> } | { asChild?: false; children?: ReactNode });

function Button({ className, variant, size, loading = false, disabled = false, asChild, children, type = "button", ...props }: ButtonProps) {
  const labelId = useId();
  const child = asChild ? Children.only(children) : undefined;
  const childProps = isValidElement<ComponentProps<"button">>(child) ? child.props : undefined;
  const inactive = disabled || childProps?.disabled || loading;
  const label = <>{loading ? <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none" /> : null}<span id={labelId} className="inline-flex items-center justify-center gap-2">{childProps ? childProps.children : children}</span></>;
  const labelledBy = props["aria-labelledby"] ?? childProps?.["aria-labelledby"] ?? (props["aria-label"] || childProps?.["aria-label"] ? undefined : labelId);
  return <Primitive
    {...props}
    type={type}
    data-slot="ob-button"
    data-loading={loading || undefined}
    render={child ? cloneElement(child, {
      children: label,
      disabled: disabled || childProps?.disabled || undefined,
      onClick: event => { if (!inactive) childProps?.onClick?.(event); },
    }) : undefined}
    disabled={inactive}
    focusableWhenDisabled={loading && !disabled && !childProps?.disabled}
    aria-labelledby={labelledBy}
    className={resolveClassName(buttonVariants({ variant, size }), className)}
  >
    {label}
  </Primitive>;
}

export { Button, buttonVariants };
export type { ButtonProps };
