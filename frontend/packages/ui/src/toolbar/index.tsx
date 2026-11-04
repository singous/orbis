import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { cn } from "cn";

function Toolbar({ className, ...props }: ToolbarPrimitive.Root.Props) {
  return <ToolbarPrimitive.Root data-slot="toolbar" className={cn("flex items-center gap-1 data-[orientation=vertical]:flex-col", className)} {...props} />;
}

const ToolbarButton = ToolbarPrimitive.Button;
const ToolbarGroup = ToolbarPrimitive.Group;
const ToolbarInput = ToolbarPrimitive.Input;
const ToolbarLink = ToolbarPrimitive.Link;
const ToolbarSeparator = ToolbarPrimitive.Separator;

export { Toolbar, ToolbarButton, ToolbarGroup, ToolbarInput, ToolbarLink, ToolbarSeparator };
