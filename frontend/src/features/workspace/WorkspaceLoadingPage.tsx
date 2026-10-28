import { PageContainer } from "../../shared/ui/PageContainer";
import { LoadingState } from "../../shared/ui/LoadingState";
import { WorkspaceShell } from "./WorkspaceShell";

/** Lazy routes keep the same workspace frame while their code is arriving. */
export function WorkspaceLoadingPage() {
  return <WorkspaceShell loading><PageContainer title="工作空间" description="正在打开工作空间…"><LoadingState label="正在打开工作空间…" variant="cards" /></PageContainer></WorkspaceShell>;
}
