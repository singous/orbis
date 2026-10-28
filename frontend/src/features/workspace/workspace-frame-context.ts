import { createContext } from "react";
import type { WorkspaceShellProps } from "./WorkspaceShell";

export type WorkspaceChrome = Omit<WorkspaceShellProps, "children" | "loading">;
export const WorkspaceFrameContext = createContext<{
  content: HTMLDivElement | null;
  configure: (owner: symbol, chrome: WorkspaceChrome, loading: boolean) => void;
  release: (owner: symbol) => void;
} | null>(null);
