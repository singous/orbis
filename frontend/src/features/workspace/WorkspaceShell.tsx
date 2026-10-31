import { useContext, useLayoutEffect, useState } from "react";
import { SearchPaletteProvider } from "../search/search-palette-context";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceLayoutContext } from "./workspace-layout-context";
import type { WorkspaceShellProps } from "./workspace-layout";

export type { WorkspaceShellProps } from "./workspace-layout";
export type { WorkspaceSidebarConfig } from "./workspace-sidebar-config";

/** Supply route metadata; standalone consumers receive a local workspace layout. */
export function WorkspaceShell(props: WorkspaceShellProps) {
  const frame = useContext(WorkspaceLayoutContext);
  return frame ? <WorkspacePage {...props} /> : <SearchPaletteProvider><WorkspaceLayout {...props} /></SearchPaletteProvider>;
}

function WorkspacePage({ children, loading = false, ...chrome }: WorkspaceShellProps) {
  const frame = useContext(WorkspaceLayoutContext)!;
  const [owner] = useState(() => Symbol("workspace-route"));
  const { sidebar, toolbar, sectionTitle, contentLayout, contextPanel, contextOpen, onOpenContext } = chrome;
  useLayoutEffect(() => {
    frame.configure(owner, { sidebar, toolbar, sectionTitle, contentLayout, contextPanel, contextOpen, onOpenContext }, loading);
  }, [frame.configure, owner, sidebar, toolbar, sectionTitle, contentLayout, contextPanel, contextOpen, onOpenContext, loading]);
  useLayoutEffect(() => () => frame.release(owner), [frame.release, owner]);
  return children;
}
