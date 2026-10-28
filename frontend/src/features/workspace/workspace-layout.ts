import type { ReactNode } from "react";
import type { WorkspaceSidebarConfig } from "./workspace-sidebar-config";

export type WorkspaceShellProps = {
  children?: ReactNode;
  loading?: boolean;
  sectionTitle?: ReactNode;
  sidebar?: WorkspaceSidebarConfig | false;
  toolbar?: ReactNode;
  contentLayout?: "page" | "document";
  contextPanel?: ReactNode;
  contextOpen?: boolean;
  onOpenContext?: () => void;
};

export type WorkspaceChrome = Omit<WorkspaceShellProps, "children" | "loading">;
