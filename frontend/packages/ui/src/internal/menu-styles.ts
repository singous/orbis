import { createContext } from "react";
import type { ControlSize } from "./control-size";

export const MenuSizeContext = createContext<ControlSize>("default");

export const menuSurfaceClassName = "group/orbis-menu max-w-[calc(100vw-2rem)] bg-popover text-popover-foreground shadow-lg";
export const menuStackClassName = "gap-1 group-data-[size=xs]/orbis-menu:gap-0 group-data-[size=sm]/orbis-menu:gap-0.75 group-data-[size=lg]/orbis-menu:gap-1.5 group-data-[size=xl]/orbis-menu:gap-2";
export const menuSurfaceSize = {
  xs: "gap-0 rounded-md p-1 text-[11px]",
  sm: "gap-0.75 rounded-lg p-1.75 text-[13px] leading-[18px]",
  default: "gap-1 rounded-xl p-2 text-sm",
  lg: "gap-1.5 rounded-2xl p-2.5 text-base",
  xl: "gap-2 rounded-3xl p-3 text-lg",
} satisfies Record<ControlSize, string>;

export const menuCaptionClassName = [
  "text-xs leading-4",
  "group-data-[size=xs]/orbis-menu:text-[10px] group-data-[size=sm]/orbis-menu:text-[11px]",
  "group-data-[size=lg]/orbis-menu:text-sm group-data-[size=lg]/orbis-menu:leading-5",
  "group-data-[size=xl]/orbis-menu:text-base group-data-[size=xl]/orbis-menu:leading-6",
].join(" ");
export const menuIconClassName = "size-4 group-data-[size=xs]/orbis-menu:size-3 group-data-[size=sm]/orbis-menu:size-3.75 group-data-[size=lg]/orbis-menu:size-5 group-data-[size=xl]/orbis-menu:size-6";
export const menuRowClassName = [
  "gap-2.5 rounded-md px-3 py-2 text-sm [&>svg]:text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
  "group-data-[size=xs]/orbis-menu:gap-1.5 group-data-[size=xs]/orbis-menu:px-2 group-data-[size=xs]/orbis-menu:py-1 group-data-[size=xs]/orbis-menu:text-[11px] group-data-[size=xs]/orbis-menu:[&_svg:not([class*='size-'])]:size-3",
  "group-data-[size=sm]/orbis-menu:gap-2.25 group-data-[size=sm]/orbis-menu:px-2.75 group-data-[size=sm]/orbis-menu:py-1.75 group-data-[size=sm]/orbis-menu:text-[13px] group-data-[size=sm]/orbis-menu:leading-[18px] group-data-[size=sm]/orbis-menu:[&_svg:not([class*='size-'])]:size-3.75",
  "group-data-[size=lg]/orbis-menu:gap-3 group-data-[size=lg]/orbis-menu:px-3.5 group-data-[size=lg]/orbis-menu:py-2.5 group-data-[size=lg]/orbis-menu:text-base group-data-[size=lg]/orbis-menu:[&_svg:not([class*='size-'])]:size-5",
  "group-data-[size=xl]/orbis-menu:gap-3.5 group-data-[size=xl]/orbis-menu:px-4 group-data-[size=xl]/orbis-menu:py-3 group-data-[size=xl]/orbis-menu:text-lg group-data-[size=xl]/orbis-menu:[&_svg:not([class*='size-'])]:size-6",
].join(" ");
