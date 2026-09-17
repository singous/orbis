import { Navigate, createBrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";

import { AccountSettingsPage } from "../features/account/AccountSettingsPage";
import { HomePage } from "../features/home/HomePage";
import { ArchivePage } from "../features/documents/ArchivePage";
import { CollectionsPage } from "../features/documents/CollectionsPage";
import { DocumentEditorPage } from "../features/documents/DocumentEditorPage";
import { DocumentOverviewPage } from "../features/documents/DocumentOverviewPage";
import { DocumentSearchPage } from "../features/documents/DocumentSearchPage";
import { NotebookPage } from "../features/documents/NotebookPage";
import { RecentDocumentsPage } from "../features/documents/RecentDocumentsPage";
import { AcceptInvitationPage } from "../features/members/AcceptInvitationPage";
import { ConfirmOwnershipPage } from "../features/members/ConfirmOwnershipPage";
import { MemberSettingsPage } from "../features/members/MemberSettingsPage";
import { KnowledgePlaceholderPage, MemoryPlaceholderPage } from "../features/placeholders/PlaceholderPage";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoginPage } from "./LoginPage";

const SitesPage = lazy(() => import("../features/sites/SitesPage").then((module) => ({ default: module.SitesPage })));
const SiteEditorPage = lazy(() => import("../features/sites/SiteEditorPage").then((module) => ({ default: module.SiteEditorPage })));
const PublicSitePage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.PublicSitePage })));
const SitePreviewPage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.SitePreviewPage })));
const siteFallback = <div className="site-reader-status" role="status">正在打开站点…</div>;

export const router = createBrowserRouter([
  { path: "/s/:slug/:pageSlug?", element: <Suspense fallback={siteFallback}><PublicSitePage /></Suspense> },
  { path: "/sites", element: <RequireAuth><Suspense fallback={siteFallback}><SitesPage /></Suspense></RequireAuth> },
  { path: "/sites/:siteId", element: <RequireAuth><Suspense fallback={siteFallback}><SiteEditorPage /></Suspense></RequireAuth> },
  { path: "/sites/:siteId/preview/:pageSlug?", element: <RequireAuth><Suspense fallback={siteFallback}><SitePreviewPage /></Suspense></RequireAuth> },
  {
    path: "/",
    element: <Navigate to="/home" replace />,
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
    element: (
      <RequireAuth>
        <HomePage />
      </RequireAuth>
    ),
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
        <DocumentSearchPage />
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
    path: "/knowledge",
    element: (
      <RequireAuth>
        <KnowledgePlaceholderPage />
      </RequireAuth>
    ),
  },
  {
    path: "/memory",
    element: (
      <RequireAuth>
        <MemoryPlaceholderPage />
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
  { path: "*", element: <Navigate to="/home" replace /> },
]);
