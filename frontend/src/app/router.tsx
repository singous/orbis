import { Navigate, createBrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";

import { LoadingState } from "../shared/ui/LoadingState";
import { WorkspaceLoadingPage } from "../features/workspace/WorkspaceLoadingPage";
import { AccountSettingsPage } from "../features/account/AccountSettingsPage";
import { HomePage } from "../features/home/HomePage";
import { DEFAULT_WORKSPACE_PATH } from "../features/workspace/workspace-areas";
import { ArchivePage } from "../features/documents/ArchivePage";
import { CollectionsPage } from "../features/documents/CollectionsPage";
import { DocumentEditorPage } from "../features/documents/editor/DocumentEditorPage";
import { DocumentOverviewPage } from "../features/documents/DocumentOverviewPage";
import { LegacyDocumentSearchRedirect } from "../features/search/LegacyDocumentSearchRedirect";
import { NotebookPage } from "../features/documents/NotebookPage";
import { RecentDocumentsPage } from "../features/documents/RecentDocumentsPage";
import { AcceptInvitationPage } from "../features/members/AcceptInvitationPage";
import { ConfirmOwnershipPage } from "../features/members/ConfirmOwnershipPage";
import { MemberSettingsPage } from "../features/members/MemberSettingsPage";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoginPage } from "./LoginPage";

const PublicSharePage = lazy(() => import("../features/sharing/PublicSharePage").then(module => ({ default: module.PublicSharePage })));

const loadSitesPage = () => import("../features/sites/SitesPage");

const SearchPage = lazy(() => import("../features/search/SearchPage").then((module) => ({ default: module.SearchPage })));
const SearchOpenPage = lazy(() => import("../features/search/SearchOpenPage").then((module) => ({ default: module.SearchOpenPage })));
const SiteEditorPage = lazy(() => import("../features/sites/SiteEditorPage").then((module) => ({ default: module.SiteEditorPage })));
const PublicSitePage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.PublicSitePage })));
const SitePreviewPage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.SitePreviewPage })));
const siteFallback = <div className="site-reader-status"><LoadingState label="正在打开站点…" variant="editor" /></div>;
const workspaceFallback = <WorkspaceLoadingPage />;

const SheetPage = lazy(() => import("../features/sheets/SheetPage").then(m => ({default:m.SheetPage})));
const SheetsHome = lazy(() => import("../features/sheets/SheetsHome").then(m => ({default:m.SheetsHome})));
const PublicSheetForm = lazy(() => import("../features/sheets/SheetForms").then(m => ({default:m.PublicSheetForm})));

export const router = createBrowserRouter([
 {path:"/sheets",element:<RequireAuth><Suspense fallback={workspaceFallback}><SheetsHome /></Suspense></RequireAuth>},
 {path:"/sheets/:sheetId",element:<RequireAuth><Suspense fallback={workspaceFallback}><SheetPage /></Suspense></RequireAuth>},
 {path:"/forms/:token",element:<Suspense fallback={<LoadingState label="正在打开表单…" />}><PublicSheetForm /></Suspense>},
  { path: "/share/:shareToken/:noteId?", element: <Suspense fallback={<LoadingState label="正在打开分享…" variant="editor" />}><PublicSharePage /></Suspense> },
  { path: "/search", element: <RequireAuth><Suspense fallback={workspaceFallback}><SearchPage /></Suspense></RequireAuth> },
  { path: "/search/open", element: <RequireAuth><Suspense fallback={workspaceFallback}><SearchOpenPage /></Suspense></RequireAuth> },
  { path: "/s/:slug/*", element: <Suspense fallback={siteFallback}><PublicSitePage /></Suspense> },
  { path: "/sites", lazy: async () => {
      const { SitesPage } = await loadSitesPage();
      return { Component: () => <RequireAuth><SitesPage /></RequireAuth> };
    },
  },
  { path: "/sites/:siteId", element: <RequireAuth><Suspense fallback={workspaceFallback}><SiteEditorPage /></Suspense></RequireAuth> },
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
  { path: "/invite/:token", element: <AcceptInvitationPage /> },
  { path: "/invitations/accept", element: <AcceptInvitationPage /> },
  { path: "/ownership-transfer/:token", element: <ConfirmOwnershipPage /> },
  { path: "/ownership-transfers/confirm", element: <ConfirmOwnershipPage /> },
  {
    path: "/home",
    element: <RequireAuth><HomePage /></RequireAuth>,
  },
  {
    path: "/documents",
    element: (
      <RequireAuth>
        <DocumentOverviewPage />
      </RequireAuth>
    ),
  },
  {
    path: "/documents/recent",
    element: (
      <RequireAuth>
        <RecentDocumentsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/documents/collections",
    element: (
      <RequireAuth>
        <CollectionsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/documents/search",
    element: (
      <RequireAuth>
        <LegacyDocumentSearchRedirect />
      </RequireAuth>
    ),
  },
  {
    path: "/documents/archive",
    element: (
      <RequireAuth>
        <ArchivePage />
      </RequireAuth>
    ),
  },
  {
    path: "/collections/:collectionId",
    element: (
      <RequireAuth>
        <NotebookPage />
      </RequireAuth>
    ),
  },
  {
    path: "/settings/account",
    element: (
      <RequireAuth>
        <AccountSettingsPage />
      </RequireAuth>
    ),
  },
  {
    path: "/documents/:noteId",
    element: (
      <RequireAuth>
        <DocumentEditorPage />
      </RequireAuth>
    ),
  },
  {
    path: "/settings/members",
    element: (
      <RequireAuth>
        <MemberSettingsPage />
      </RequireAuth>
    ),
  },
  { path: "*", element: <Navigate to={DEFAULT_WORKSPACE_PATH} replace /> },
]);
