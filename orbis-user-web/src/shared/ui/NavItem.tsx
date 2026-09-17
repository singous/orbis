import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** Small-caps section divider for navigation groups. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Labeled navigation row for list-style sidebars. */
export function NavItem({
  to,
  icon,
  children,
  badge,
  disabled = false,
  end = false,
}: {
  to: string;
  icon?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (event) => event.preventDefault() : undefined}
      className={({ isActive }) =>
        cn(
          "flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm transition-colors duration-100",
          isActive
            ? "bg-[var(--surface-active)] font-medium text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
          disabled && "pointer-events-none opacity-50",
        )
      }
    >
      {icon ? <span className="shrink-0 [&>svg]:block">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </NavLink>
  );
}

/** Icon-only navigation tile for compact rails; label lives in the tooltip. */
export function NavIcon({
  to,
  label,
  icon,
  hint,
  end = false,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          "relative grid h-[42px] w-[42px] place-items-center rounded-[var(--radius-pop)] transition-colors duration-150",
          isActive
            ? "bg-[var(--border-inverse)] text-[var(--text-oninverse)]"
            : "text-[var(--text-oninverse)] opacity-50 hover:bg-[var(--border-inverse)] hover:opacity-100",
        )
      }
    >
      {icon}
      {hint ? (
        <em className="absolute top-full mt-0.5 whitespace-nowrap text-[9px] not-italic text-[var(--text-oninverse)] opacity-50">
          {hint}
        </em>
      ) : null}
    </NavLink>
  );
}
