import { PageContainer } from "../../shared/ui/PageContainer";
import { LoadingState } from "../../shared/ui/LoadingState";
import { WorkspaceShell } from "./WorkspaceShell";

/** Lazy routes keep the same workspace frame while their code is arriving. */
export function WorkspaceLoadingPage() {
  return <WorkspaceShell><PageContainer title="站点" description="正在打开站点…"><LoadingState label="正在打开站点…" variant="cards" /></PageContainer></WorkspaceShell>;
}
