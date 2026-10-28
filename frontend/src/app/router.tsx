import { lazy, Suspense } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { BoardNavigationGuard } from "../features/boards/BoardNavigationGuard";
import { DEFAULT_WORKSPACE_PATH } from "../features/workspace/workspace-areas";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoadingState } from "../shared/ui/LoadingState";
import { LoginPage } from "./LoginPage";
import { publicRoutes } from "./public-routes";
import { workspaceRoutes } from "./workspace-routes";

const WorkspaceRoute = lazy(() => import("./WorkspaceRoute").then(module => ({ default: module.WorkspaceRoute })));

export const router = createBrowserRouter([
  { element: <RequireAuth><Suspense fallback={<LoadingState label="正在打开工作空间…" variant="editor" />}><BoardNavigationGuard /><WorkspaceRoute /></Suspense></RequireAuth>, children: workspaceRoutes },
  ...publicRoutes,
  { path: "/", element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace /> },
  { path: "/login", element: <LoginPage mode="login" /> },
  { path: "/setup", element: <LoginPage mode="setup" /> },
  { path: "*", element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace /> },
]);
