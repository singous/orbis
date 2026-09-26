import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

type ActionButtonProps = Omit<ComponentProps<typeof HeroButton>, "className" | "children" | "variant" | "render"> & {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
};

/** HeroUI interaction semantics for controls whose shape belongs to a feature layout. */
export function ActionButton({ className, disabled, isDisabled, title, type = "submit", ...props }: ActionButtonProps) {
  return <HeroButton variant="ghost" className={cn("orbis-action-button", className)} isDisabled={disabled ?? isDisabled} type={type} render={(domProps) => <button {...domProps} title={title} />} {...props} />;
}
