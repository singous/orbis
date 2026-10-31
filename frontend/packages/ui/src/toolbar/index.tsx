import { Toolbar as Primitive } from "@base-ui/react/toolbar";
import type { ComponentProps, CSSProperties } from "react";
import { ToolbarScopeContext } from "../internal/toolbar-scope";
import { resolveClassName } from "../internal/resolve-class-name";
import { cn } from "../cn";

type ToolbarState = { disabled: boolean; orientation: "horizontal" | "vertical" };
type ToolbarProps = Omit<ComponentProps<"div">, "className" | "style"> & {
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
  loopFocus?: boolean;
  className?: string | ((state: ToolbarState) => string | undefined);
  style?: CSSProperties | ((state: ToolbarState) => CSSProperties | undefined);
};
function Toolbar({ orientation = "horizontal", className, ...props }: ToolbarProps) {
  return <ToolbarScopeContext.Provider value={true}><Primitive.Root {...props} orientation={orientation} data-slot="ob-toolbar" className={resolveClassName(cn("flex items-center gap-1", orientation === "vertical" && "flex-col"), className)} /></ToolbarScopeContext.Provider>;
}
export { Toolbar };
export type { ToolbarProps };
