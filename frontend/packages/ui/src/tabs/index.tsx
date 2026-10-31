import { Tabs as Primitive } from "@base-ui/react/tabs";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../cn";
import { resolveClassName } from "../internal/resolve-class-name";
import { controlFocus } from "../internal/focus";

type TabsProps<Value extends string | number> = Omit<ComponentProps<"div">, "onChange" | "defaultValue"> & { orientation?: "horizontal" | "vertical" } & (
  | { value: Value | null; onValueChange: (value: Value | null) => void; defaultValue?: never }
  | { value?: never; defaultValue?: Value | null; onValueChange?: (value: Value | null) => void }
);
function Tabs<Value extends string | number>({ value, defaultValue, onValueChange, ...props }: TabsProps<Value>) {
  return <Primitive.Root {...props} value={value} defaultValue={defaultValue} onValueChange={next => onValueChange?.(next as Value | null)} data-slot="ob-tabs" />;
}
type TabsListProps = ComponentProps<"div"> & { activateOnFocus?: boolean };
function TabsList({ className, activateOnFocus = true, ...props }: TabsListProps) { return <Primitive.List {...props} activateOnFocus={activateOnFocus} data-slot="ob-tabs-list" className={cn("relative flex gap-1", className)} />; }
type TabsTriggerState = { active: boolean; disabled: boolean };
type TabsTriggerProps = Omit<ComponentProps<"button">, "className" | "style" | "value"> & {
  value: string | number;
  className?: string | ((state: TabsTriggerState) => string | undefined);
  style?: CSSProperties | ((state: TabsTriggerState) => CSSProperties | undefined);
};
function TabsTrigger({ className, ...props }: TabsTriggerProps) { return <Primitive.Tab {...props} data-slot="ob-tabs-trigger" className={resolveClassName(`inline-flex min-h-(--ob-control-height-md) items-center justify-center gap-2 rounded-ob-sm px-3 py-2 text-sm text-ob-muted-foreground data-active:bg-ob-secondary data-active:text-ob-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50 ${controlFocus}`, className)} />; }
type TabsContentProps = ComponentProps<"div"> & { value: string | number; keepMounted?: boolean };
function TabsContent({ className, ...props }: TabsContentProps) { return <Primitive.Panel {...props} data-slot="ob-tabs-content" className={cn("outline-none", controlFocus, className)} />; }
export { Tabs, TabsList, TabsTrigger, TabsContent };
export type { TabsProps, TabsListProps, TabsTriggerProps, TabsContentProps };
