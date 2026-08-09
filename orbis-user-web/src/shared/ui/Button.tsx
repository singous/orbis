import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-[#151515] text-white hover:bg-[#30302f]",
  secondary: "border border-[var(--border)] bg-white text-[var(--text)] hover:bg-[var(--surface-hover)]",
  ghost: "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
  danger: "bg-[var(--danger)] text-white hover:bg-[var(--danger-strong)]",
};

export function Button({ variant = "secondary", icon, className = "", children, ...props }: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        variantClass[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
