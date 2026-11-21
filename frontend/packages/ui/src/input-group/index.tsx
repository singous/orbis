import type { ComponentProps } from "react";
import { Input } from "../input";
import { cn } from "../cn";

function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      data-slot="input-group"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-input bg-muted/60 px-2.5 transition-colors",
        "has-[[data-slot=input]:focus-visible]:border-ring has-[[data-slot=input]:focus-visible]:ring-3 has-[[data-slot=input]:focus-visible]:ring-ring/50",
        "has-[[data-slot=input][aria-invalid=true]]:border-destructive has-[[data-slot=input][aria-invalid=true]:focus-visible]:ring-destructive/20",
        "has-[[data-slot=input]:disabled]:opacity-50",
        className,
      )}
    />
  );
}

function InputGroupAddon({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} data-slot="input-group-addon" className={cn("inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground", className)} />;
}

function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      {...props}
      className={cn("w-0 flex-1 rounded-none border-0 bg-transparent px-0 focus-visible:ring-0 disabled:opacity-100 aria-invalid:ring-0", className)}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupInput };
