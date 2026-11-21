import { Suspense, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { WorkspaceFrame } from "../features/workspace/WorkspaceFrame";
import { SearchPaletteProvider } from "../features/search/search-palette-context";
import { WorkspaceLoadingPage } from "../features/workspace/WorkspaceLoadingPage";
import type { WorkspaceLoadingKind } from "../features/workspace/WorkspaceLoadingContent";

/** Keep navigation, route loading and search in one mounted workspace scope. */
export function WorkspaceRoute({ children, loadingKind }: { children?: ReactNode; loadingKind?: WorkspaceLoadingKind }) {
  return <SearchPaletteProvider>
    <WorkspaceFrame><Suspense fallback={<WorkspaceLoadingPage loadingKind={loadingKind} />}>{children ?? <Outlet />}</Suspense></WorkspaceFrame>
  </SearchPaletteProvider>;
}
