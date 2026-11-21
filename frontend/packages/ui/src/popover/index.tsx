import { useOverlayScope } from "../internal/overlay-scope"
import { menuRowClassName, menuSurfaceClassName, menuSurfaceSize } from "../internal/menu-styles"
import type { ControlSize } from "../internal/control-size"
import { buttonVariants } from "../button"
"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

const popoverSize = {
  xs: "gap-1.5 rounded-sm p-1.5 text-[11px]",
  sm: "gap-2 rounded-md p-2 text-xs",
  default: "gap-2.5 rounded-lg p-2.5 text-sm",
  lg: "gap-3 rounded-xl p-3 text-base",
  xl: "gap-3.5 rounded-2xl p-3.5 text-lg",
} satisfies Record<ControlSize, string>

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  appearance = "default",
  size = "default",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & { appearance?: "default" | "menu"; size?: ControlSize }) {
  const scope = useOverlayScope()
  return (
    <PopoverPrimitive.Portal {...scope}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          data-size={size}
          className={cn(
            appearance === "menu" ? cn(menuSurfaceClassName, menuSurfaceSize[size], "w-max") : cn("w-72 bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10", popoverSize[size]),
            "z-50 flex origin-(--transform-origin) flex-col outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

const popoverActionClassName = cn(buttonVariants({ variant: "ghost" }), menuRowClassName, "h-auto w-full justify-start hover:bg-accent dark:hover:bg-accent")

export {
  popoverActionClassName,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
