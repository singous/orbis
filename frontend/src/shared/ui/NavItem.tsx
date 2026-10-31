import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

import { cn } from "./cn";

/** Small-caps section divider for navigation groups. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-3 pb-1 pt-4 text-sm font-medium uppercase tracking-wide text-(--ob-page-muted-foreground)",
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
          "orbis-nav-item ob-focus-ring min-h-(--ob-control-height-md) focus-visible:outline-offset-[-2px] flex items-center gap-2 rounded-ob-xl px-3 text-sm transition-colors duration-100 [&:not([aria-disabled=true]):is(:hover,:focus-visible,[aria-current=page])]:bg-(--ob-item-hover-bg) [&:not([aria-disabled=true]):is(:hover,:focus-visible,[aria-current=page])]:text-(--ob-item-foreground) [&:not([aria-disabled=true]):is(:hover,:focus-visible,[aria-current=page])_svg]:text-inherit",
          isActive
            ? "bg-(--ob-item-selected-bg) font-medium text-ob-foreground"
            : "text-(--ob-page-muted-foreground)",
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
          "orbis-nav-icon ob-focus-ring size-(--ob-control-height-touch) focus-visible:outline-offset-[-2px] relative grid place-items-center rounded-ob-xl transition-colors duration-150",
          isActive
            ? "bg-[color-mix(in_oklab,var(--ob-primary-foreground)_20%,transparent)] text-ob-primary-foreground"
            : "text-ob-primary-foreground opacity-50 hover:bg-[color-mix(in_oklab,var(--ob-primary-foreground)_20%,transparent)] hover:opacity-100",
        )
      }
    >
      {icon}
      {hint ? (
        <em className="absolute top-full mt-0.5 whitespace-nowrap text-xs not-italic text-ob-primary-foreground opacity-50">
          {hint}
        </em>
      ) : null}
    </NavLink>
  );
}
