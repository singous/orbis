import { Avatar as Primitive } from "@base-ui/react/avatar";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { resolveClassName } from "../internal/resolve-class-name";

type AvatarProps = Omit<ComponentProps<"span">, "children" | "className" | "style"> & {
  src?: string;
  alt?: string;
  fallback: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string | ((state: { imageLoadingStatus: "idle" | "loading" | "loaded" | "error" }) => string | undefined);
  style?: CSSProperties | ((state: { imageLoadingStatus: "idle" | "loading" | "loaded" | "error" }) => CSSProperties | undefined);
};
const sizes = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" };
function Avatar({ src, alt = "", fallback, size = "md", className, ...props }: AvatarProps) {
  return <Primitive.Root {...props} data-slot="ob-avatar" className={resolveClassName(`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ob-secondary text-ob-foreground font-medium ${sizes[size]}`, className)}>
    {src ? <Primitive.Image src={src} alt={alt} className="size-full object-cover" /> : null}
    <Primitive.Fallback data-slot="ob-avatar-fallback">{fallback}</Primitive.Fallback>
  </Primitive.Root>;
}
export { Avatar };
export type { AvatarProps };
