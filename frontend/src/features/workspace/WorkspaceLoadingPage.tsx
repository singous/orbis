import { WorkspaceLoadingContent } from "./WorkspaceLoadingContent";
import { WorkspaceShell } from "./WorkspaceShell";

/** Lazy routes keep the same workspace frame while their code is arriving. */
export function WorkspaceLoadingPage() {
  return <WorkspaceShell loading><WorkspaceLoadingContent /></WorkspaceShell>;
}
