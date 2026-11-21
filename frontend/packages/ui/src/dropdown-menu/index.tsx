import { useOverlayScope } from "../internal/overlay-scope"
import { MenuSizeContext, menuCaptionClassName, menuIconClassName, menuRowClassName, menuStackClassName, menuSurfaceClassName, menuSurfaceSize } from "../internal/menu-styles"
import type { ControlSize } from "../internal/control-size"
import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "cn"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  const scope = useOverlayScope()
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...scope} {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  size,
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & { size?: ControlSize }) {
  const inheritedSize = React.useContext(MenuSizeContext)
  const menuSize = size ?? inheritedSize
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          data-size={menuSize}
          className={cn(menuSurfaceClassName, menuSurfaceSize[menuSize], "z-50 flex w-max min-w-0 max-h-(--available-height) origin-(--transform-origin) flex-col overflow-x-hidden overflow-y-auto duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          <MenuSizeContext.Provider value={menuSize}>{children}</MenuSizeContext.Provider>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

function DropdownMenuGroup({ className, ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" className={cn("flex flex-col", menuStackClassName, className)} {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-3 py-1 font-medium text-muted-foreground data-inset:pl-9 group-data-[size=xs]/orbis-menu:px-2 group-data-[size=sm]/orbis-menu:px-2.75 group-data-[size=lg]/orbis-menu:px-3.5 group-data-[size=xl]/orbis-menu:px-4",
        menuCaptionClassName,
        className
      )}
      {...props}
    />
  )
}

type MenuItemDetails = {
  icon?: React.ReactNode
  description?: React.ReactNode
  shortcut?: React.ReactNode
}

const itemStyles = "relative flex min-w-0 shrink-0 cursor-default items-center outline-hidden select-none focus:bg-accent data-highlighted:bg-accent data-inset:ps-9 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"

function MenuItemBody({ children, icon, description, shortcut, descriptionId }: MenuItemDetails & {
  children: React.ReactNode
  descriptionId: string
}) {
  if (icon == null && description == null && shortcut == null) return children
  return (
    <>
      {icon != null ? <span aria-hidden="true" className="inline-flex shrink-0 text-muted-foreground group-data-[level=danger]/dropdown-menu-item:text-destructive">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="wrap-anywhere">{children}</span>
        {description != null ? <span id={descriptionId} aria-hidden="true" className={cn(menuCaptionClassName, "wrap-anywhere text-muted-foreground")}>{description}</span> : null}
      </span>
      {shortcut != null ? <DropdownMenuShortcut aria-hidden="true">{shortcut}</DropdownMenuShortcut> : null}
    </>
  )
}

function DropdownMenuItem({
  className, inset, level, variant, children, icon, description, shortcut, "aria-describedby": describedBy, ...props
}: MenuPrimitive.Item.Props & MenuItemDetails & {
  inset?: boolean
  level?: "normal" | "danger"
  variant?: "default" | "destructive"
}) {
  const id = React.useId()
  const tone = level ?? (variant === "destructive" ? "danger" : "normal")
  return (
    <MenuPrimitive.Item
      {...props}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-level={tone}
      data-variant={tone === "danger" ? "destructive" : "default"}
      aria-describedby={description == null ? describedBy : describedBy ? `${describedBy} ${id}` : id}
      className={cn(
        "group/dropdown-menu-item",
        itemStyles,
        menuRowClassName,
        "data-[level=danger]:text-destructive data-[level=danger]:focus:text-destructive data-[level=danger]:data-highlighted:text-destructive data-[level=danger]:[&>svg]:text-destructive",
        className,
      )}
    >
      <MenuItemBody icon={icon} description={description} shortcut={shortcut} descriptionId={id}>{children}</MenuItemBody>
    </MenuPrimitive.Item>
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className, inset, children, icon, description, shortcut, "aria-describedby": describedBy, ...props
}: MenuPrimitive.SubmenuTrigger.Props & MenuItemDetails & { inset?: boolean }) {
  const id = React.useId()
  return (
    <MenuPrimitive.SubmenuTrigger
      {...props}
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      aria-describedby={description == null ? describedBy : describedBy ? `${describedBy} ${id}` : id}
      className={cn(itemStyles, menuRowClassName, "data-popup-open:bg-accent", className)}
    >
      <MenuItemBody icon={icon} description={description} shortcut={shortcut} descriptionId={id}>{children}</MenuItemBody>
      <ChevronRightIcon aria-hidden="true" className={cn(menuIconClassName, "ms-auto text-muted-foreground")} />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -8,
  side = "right",
  sideOffset = 4,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={className}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        itemStyles, menuRowClassName, "pe-8 group-data-[size=xs]/orbis-menu:pe-6 group-data-[size=sm]/orbis-menu:pe-7.5 group-data-[size=lg]/orbis-menu:pe-10 group-data-[size=xl]/orbis-menu:pe-12",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute end-3 flex items-center justify-center group-data-[size=xs]/orbis-menu:end-2 group-data-[size=sm]/orbis-menu:end-2.75 group-data-[size=lg]/orbis-menu:end-3.5 group-data-[size=xl]/orbis-menu:end-4"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
      className={cn("flex flex-col", menuStackClassName, props.className)}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        itemStyles, menuRowClassName, "pe-8 group-data-[size=xs]/orbis-menu:pe-6 group-data-[size=sm]/orbis-menu:pe-7.5 group-data-[size=lg]/orbis-menu:pe-10 group-data-[size=xl]/orbis-menu:pe-12",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute end-3 flex items-center justify-center group-data-[size=xs]/orbis-menu:end-2 group-data-[size=sm]/orbis-menu:end-2.75 group-data-[size=lg]/orbis-menu:end-3.5 group-data-[size=xl]/orbis-menu:end-4"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-1 h-px bg-border group-data-[size=xs]/orbis-menu:my-0 group-data-[size=sm]/orbis-menu:my-0.75 group-data-[size=lg]/orbis-menu:my-1.5 group-data-[size=xl]/orbis-menu:my-2", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ms-auto shrink-0 tabular-nums text-muted-foreground", menuCaptionClassName,
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
