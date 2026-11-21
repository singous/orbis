import { Field as Primitive } from "@base-ui/react/field";
import { cn } from "../cn";

function Field({ className, ...props }: Primitive.Root.Props) {
  return <Primitive.Root data-slot="field" className={cn("grid min-w-0 gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: Primitive.Label.Props) {
  return <Primitive.Label data-slot="field-label" className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

function FieldDescription({ className, ...props }: Primitive.Description.Props) {
  return <Primitive.Description data-slot="field-description" className={cn("text-xs leading-5 text-muted-foreground", className)} {...props} />;
}

function FieldError({ className, ...props }: Primitive.Error.Props) {
  return <Primitive.Error data-slot="field-error" className={cn("text-xs leading-5 text-destructive", className)} {...props} />;
}

export { Field, FieldDescription, FieldError, FieldLabel };
