import { Tooltip as HeroTooltip } from "@heroui/react/tooltip";
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";

import { cn } from "./cn";

export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
}: {
  label: string;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  const placement = (align === "center" ? side : `${side} ${align}`) as ComponentProps<typeof HeroTooltip.Content>["placement"];
  const trigger = children as ReactElement<{ className?: string; children?: ReactNode }>;

  return (
    <HeroTooltip delay={300}>
      <HeroTooltip.Trigger render={({ role: _role, className, ...props }) => cloneElement(trigger, {
        ...props,
        className: cn(trigger.props.className, className),
        children: trigger.props.children,
      })} />
      <HeroTooltip.Content
        placement={placement}
        offset={6}
        className="orbis-tooltip"
      >
        {label}
      </HeroTooltip.Content>
    </HeroTooltip>
  );
}
