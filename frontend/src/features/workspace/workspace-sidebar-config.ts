import type { ReactNode } from "react";

export type SidebarPreferences = {
  widthKey: string;
};

export const SIDEBAR_MOTION_DURATION_MS = 420;
export const SIDEBAR_MOTION_EASING = "cubic-bezier(.4, 0, .2, 1)";

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  widthKey: "orbis.sidebarWidth",
};

/** Business content supplies slots and preferences; the frame owns interaction. */
export type WorkspaceSidebarConfig = {
  id?: string;
  title: ReactNode;
  titlePlacement?: "header" | "below-header";
  leadingActions?: ReactNode;
  actions?: ReactNode;
  content: ReactNode;
  label?: string;
  collapseLabel?: string;
  expandLabel?: string;
  resizeLabel?: string;
  desktopVisible?: boolean;
  preferences?: SidebarPreferences;
};
