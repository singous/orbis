import type { ReactNode } from "react";

export type SidebarPreferences = {
  collapsedKey: string;
  widthKey: string;
};

export const SIDEBAR_MOTION_DURATION_MS = 420;
export const SIDEBAR_MOTION_EASING = "cubic-bezier(.4, 0, .2, 1)";

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  collapsedKey: "orbis.sidebarCollapsed",
  widthKey: "orbis.sidebarWidth",
};

/** Business content supplies slots and preferences; the frame owns interaction. */
export type WorkspaceSidebarConfig = {
  id?: string;
  title: ReactNode;
  actions?: ReactNode;
  content: ReactNode;
  label?: string;
  collapseLabel?: string;
  expandLabel?: string;
  resizeLabel?: string;
  desktopVisible?: boolean;
  preferences?: SidebarPreferences;
};
