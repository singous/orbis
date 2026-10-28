import { WorkspaceFrame } from "../features/workspace/WorkspaceFrame";
import { Suspense, type ReactNode } from "react";
import { SearchPaletteProvider } from "../features/search/search-palette-context";
import { WorkspaceLoadingPage } from "../features/workspace/WorkspaceLoadingPage";

/** Keep navigation, route loading and search in one mounted workspace scope. */
export function WorkspaceRoute({ children }: { children: ReactNode }) {
  return <SearchPaletteProvider>
    <WorkspaceFrame><Suspense fallback={<WorkspaceLoadingPage />}>{children}</Suspense></WorkspaceFrame>
  </SearchPaletteProvider>;
}
