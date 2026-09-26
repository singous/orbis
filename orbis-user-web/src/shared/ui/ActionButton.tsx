import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps, ComponentPropsWithRef, MouseEvent } from "react";

import { cn } from "./cn";

type ActionButtonProps = ComponentPropsWithRef<"button">;

/** HeroUI interaction semantics for controls whose shape belongs to a feature layout. */
export function ActionButton({ className, disabled, onClick, type = "submit", ...props }: ActionButtonProps) {
  const heroProps = props as ComponentProps<typeof HeroButton>;
  return <HeroButton variant="ghost" className={cn("orbis-action-button", className)} isDisabled={disabled} onClick={onClick ? (event) => onClick(event as MouseEvent<HTMLButtonElement>) : undefined} type={type} {...heroProps} />;
}
