import { Navigate, createBrowserRouter } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";

import { LoadingState } from "../shared/ui/LoadingState";
import { DEFAULT_WORKSPACE_PATH } from "../features/workspace/workspace-areas";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoginPage } from "./LoginPage";
import { BoardNavigationGuard } from "../features/boards/BoardNavigationGuard";

const WorkspaceRoute = lazy(() => import("./WorkspaceRoute").then(module => ({ default: module.WorkspaceRoute })));
const PublicSharePage = lazy(() => import("../features/sharing/PublicSharePage").then(module => ({ default: module.PublicSharePage })));

const AccountSettingsPage = lazy(() => import("../features/account/AccountSettingsPage").then(module => ({ default: module.AccountSettingsPage })));
const HomePage = lazy(() => import("../features/home/HomePage").then(module => ({ default: module.HomePage })));
const ArchivePage = lazy(() => import("../features/documents/ArchivePage").then(module => ({ default: module.ArchivePage })));
const CollectionsPage = lazy(() => import("../features/documents/CollectionsPage").then(module => ({ default: module.CollectionsPage })));
const DocumentEditorPage = lazy(() => import("../features/documents/editor/DocumentEditorPage").then(module => ({ default: module.DocumentEditorPage })));
const DocumentOverviewPage = lazy(() => import("../features/documents/DocumentOverviewPage").then(module => ({ default: module.DocumentOverviewPage })));
const LegacyDocumentSearchRedirect = lazy(() => import("../features/search/LegacyDocumentSearchRedirect").then(module => ({ default: module.LegacyDocumentSearchRedirect })));
const NotebookPage = lazy(() => import("../features/documents/NotebookPage").then(module => ({ default: module.NotebookPage })));
const RecentDocumentsPage = lazy(() => import("../features/documents/RecentDocumentsPage").then(module => ({ default: module.RecentDocumentsPage })));
const AcceptInvitationPage = lazy(() => import("../features/members/AcceptInvitationPage").then(module => ({ default: module.AcceptInvitationPage })));
const ConfirmOwnershipPage = lazy(() => import("../features/members/ConfirmOwnershipPage").then(module => ({ default: module.ConfirmOwnershipPage })));
const MemberSettingsPage = lazy(() => import("../features/members/MemberSettingsPage").then(module => ({ default: module.MemberSettingsPage })));
const SitesPage = lazy(() => import("../features/sites/SitesPage").then(module => ({ default: module.SitesPage })));

const SearchPage = lazy(() => import("../features/search/SearchPage").then((module) => ({ default: module.SearchPage })));
const SearchOpenPage = lazy(() => import("../features/search/SearchOpenPage").then((module) => ({ default: module.SearchOpenPage })));
const SiteEditorPage = lazy(() => import("../features/sites/SiteEditorPage").then((module) => ({ default: module.SiteEditorPage })));
const PublicSitePage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.PublicSitePage })));
const SitePreviewPage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.SitePreviewPage })));
const siteFallback = <div className="site-reader-status"><LoadingState label="正在打开站点…" variant="editor" /></div>;
function workspacePage(children: ReactNode) {
  return <RequireAuth><Suspense fallback={<LoadingState label="正在打开工作空间…" variant="editor" />}><BoardNavigationGuard /><WorkspaceRoute>{children}</WorkspaceRoute></Suspense></RequireAuth>;
}

function invitationPage(children: ReactNode) {
  return <Suspense fallback={<LoadingState label="正在打开邀请…" />}>{children}</Suspense>;
}

const SheetPage = lazy(() => import("../features/sheets/SheetPage").then(m => ({default:m.SheetPage})));
const QuickNotesPage = lazy(() => import("../features/quick-notes/QuickNotesPage").then(module => ({ default: module.QuickNotesPage })));
const SheetsHome = lazy(() => import("../features/sheets/SheetsHome").then(m => ({default:m.SheetsHome})));
const PublicSheetForm = lazy(() => import("../features/sheets/SheetForms").then(m => ({default:m.PublicSheetForm})));

export const router = createBrowserRouter([
 {path:"/documents/quick-notes",element:workspacePage(<QuickNotesPage />)},
 {path:"/sheets",element:workspacePage(<SheetsHome />)},
 {path:"/sheets/:sheetId",element:workspacePage(<SheetPage />)},
 {path:"/forms/:token",element:<Suspense fallback={<LoadingState label="正在打开表单…" />}><PublicSheetForm /></Suspense>},
  { path: "/share/:shareToken/:noteId?", element: <Suspense fallback={<LoadingState label="正在打开分享…" variant="editor" />}><PublicSharePage /></Suspense> },
  { path: "/search", element: workspacePage(<SearchPage />) },
  { path: "/search/open", element: workspacePage(<SearchOpenPage />) },
  { path: "/s/:slug/*", element: <Suspense fallback={siteFallback}><PublicSitePage /></Suspense> },
  { path: "/sites", element: workspacePage(<SitesPage />) },
  { path: "/sites/:siteId", element: workspacePage(<SiteEditorPage />) },
  { path: "/sites/:siteId/preview/*", element: <RequireAuth><Suspense fallback={siteFallback}><SitePreviewPage /></Suspense></RequireAuth> },
  {
    path: "/",
    element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace />,
  },
  {
    path: "/login",
    element: <LoginPage mode="login" />,
  },
  {
    path: "/setup",
    element: <LoginPage mode="setup" />,
  },
  { path: "/invite/:token", element: invitationPage(<AcceptInvitationPage />) },
  { path: "/invitations/accept", element: invitationPage(<AcceptInvitationPage />) },
  { path: "/ownership-transfer/:token", element: invitationPage(<ConfirmOwnershipPage />) },
  { path: "/ownership-transfers/confirm", element: invitationPage(<ConfirmOwnershipPage />) },
  {
    path: "/home",
    element: workspacePage(<HomePage />),
  },
  {
    path: "/documents",
    element: (
      workspacePage(<DocumentOverviewPage />)
    ),
  },
  {
    path: "/documents/recent",
    element: (
      workspacePage(<RecentDocumentsPage />)
    ),
  },
  {
    path: "/documents/collections",
    element: (
      workspacePage(<CollectionsPage />)
    ),
  },
  {
    path: "/documents/search",
    element: (
      workspacePage(<LegacyDocumentSearchRedirect />)
    ),
  },
  {
    path: "/documents/archive",
    element: (
      workspacePage(<ArchivePage />)
    ),
  },
  {
    path: "/collections/:collectionId",
    element: (
      workspacePage(<NotebookPage />)
    ),
  },
  {
    path: "/settings/account",
    element: (
      workspacePage(<AccountSettingsPage />)
    ),
  },
  {
    path: "/documents/:noteId",
    element: (
      workspacePage(<DocumentEditorPage />)
    ),
  },
  {
    path: "/settings/members",
    element: (
      workspacePage(<MemberSettingsPage />)
    ),
  },
  { path: "*", element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace /> },
]);
