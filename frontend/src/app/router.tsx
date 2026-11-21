import { lazy, Suspense } from "react";
import { Navigate, createBrowserRouter, useMatches } from "react-router-dom";
import { BoardNavigationGuard } from "../features/boards/BoardNavigationGuard";
import { DEFAULT_WORKSPACE_PATH } from "../features/workspace/workspace-areas";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { WorkspaceStartup } from "../features/workspace/WorkspaceStartup";
import { LoginPage } from "./LoginPage";
import { publicRoutes } from "./public-routes";
import { workspaceRoutes, type WorkspaceRouteHandle } from "./workspace-routes";

const WorkspaceRoute = lazy(() => import("./WorkspaceRoute").then(module => ({ default: module.WorkspaceRoute })));

const UICatalog = import.meta.env.DEV ? lazy(() => import("./catalog/UICatalog").then(module => ({ default: module.UICatalog }))) : null;
const SkeletonFixtures = import.meta.env.DEV ? lazy(() => import("./catalog/SkeletonFixtures").then(module => ({ default: module.SkeletonFixtures }))) : null;

function MatchedWorkspaceRoute() {
  const target = useMatches().at(-1);
  const loadingKind = (target?.handle as WorkspaceRouteHandle | undefined)?.workspaceLoading;
  return (
    <RequireAuth>
      <Suspense fallback={<WorkspaceStartup loadingKind={loadingKind} />}>
        <BoardNavigationGuard />
        <WorkspaceRoute loadingKind={loadingKind} />
      </Suspense>
    </RequireAuth>
  );
}

export const router = createBrowserRouter([
  ...(UICatalog ? [{ path: "/__ui", element: <Suspense fallback={null}><UICatalog /></Suspense> }] : []),
  ...(SkeletonFixtures ? [{ path: "/__bones", element: <Suspense fallback={null}><SkeletonFixtures /></Suspense> }] : []),
  { element: <MatchedWorkspaceRoute />, children: workspaceRoutes },
  ...publicRoutes,
  { path: "/", element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace /> },
  { path: "/login", element: <LoginPage mode="login" /> },
  { path: "/setup", element: <LoginPage mode="setup" /> },
  { path: "*", element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace /> },
]);
