import { createContext } from "react";
import type { WorkspaceChrome } from "./workspace-layout";

/** Page metadata is scoped to one router-owned layout, never to a DOM mount target. */
export const WorkspaceLayoutContext = createContext<{
  configure: (owner: symbol, chrome: WorkspaceChrome, loading: boolean) => void;
  release: (owner: symbol) => void;
} | null>(null);
