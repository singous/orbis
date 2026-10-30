import { lazy } from "react";
import type { RouteObject } from "react-router-dom";

const QuickNotesPage = lazy(() => import("../features/quick-notes/QuickNotesPage").then(module => ({ default: module.QuickNotesPage })));
const SheetsHome = lazy(() => import("../features/sheets/SheetsHome").then(m => ({default:m.SheetsHome})));
const SheetPage = lazy(() => import("../features/sheets/SheetPage").then(m => ({default:m.SheetPage})));
const SearchPage = lazy(() => import("../features/search/SearchPage").then((module) => ({ default: module.SearchPage })));
const SearchOpenPage = lazy(() => import("../features/search/SearchOpenPage").then((module) => ({ default: module.SearchOpenPage })));
const SitesPage = lazy(() => import("../features/sites/SitesPage").then(module => ({ default: module.SitesPage })));
const SiteEditorPage = lazy(() => import("../features/sites/SiteEditorPage").then((module) => ({ default: module.SiteEditorPage })));
const HomePage = lazy(() => import("../features/home/HomePage").then(module => ({ default: module.HomePage })));
const DocumentOverviewPage = lazy(() => import("../features/documents/DocumentOverviewPage").then(module => ({ default: module.DocumentOverviewPage })));
const RecentDocumentsPage = lazy(() => import("../features/documents/RecentDocumentsPage").then(module => ({ default: module.RecentDocumentsPage })));
const CollectionsPage = lazy(() => import("../features/documents/CollectionsPage").then(module => ({ default: module.CollectionsPage })));
const LegacyDocumentSearchRedirect = lazy(() => import("../features/search/LegacyDocumentSearchRedirect").then(module => ({ default: module.LegacyDocumentSearchRedirect })));
const ArchivePage = lazy(() => import("../features/documents/ArchivePage").then(module => ({ default: module.ArchivePage })));
const NotebookPage = lazy(() => import("../features/documents/NotebookPage").then(module => ({ default: module.NotebookPage })));
const AccountSettingsPage = lazy(() => import("../features/account/AccountSettingsPage").then(module => ({ default: module.AccountSettingsPage })));
const DocumentRoute = lazy(() => import("./DocumentRoute").then(module => ({ default: module.DocumentRoute })));
const MemberSettingsPage = lazy(() => import("../features/members/MemberSettingsPage").then(module => ({ default: module.MemberSettingsPage })));

/** All private pages share the same authenticated layout route. */
export const workspaceRoutes: RouteObject[] = [
  { path: "/documents/quick-notes", element: <QuickNotesPage /> },
  { path: "/sheets", element: <SheetsHome /> },
  { path: "/sheets/:sheetId", element: <SheetPage /> },
  { path: "/search", element: <SearchPage /> },
  { path: "/search/open", element: <SearchOpenPage /> },
  { path: "/sites", element: <SitesPage /> },
  { path: "/sites/:siteId", element: <SiteEditorPage /> },
  { path: "/home", element: <HomePage /> },
  { path: "/documents", element: <DocumentOverviewPage /> },
  { path: "/documents/recent", element: <RecentDocumentsPage /> },
  { path: "/documents/collections", element: <CollectionsPage /> },
  { path: "/documents/search", element: <LegacyDocumentSearchRedirect /> },
  { path: "/documents/archive", element: <ArchivePage /> },
  { path: "/collections/:collectionId", element: <NotebookPage /> },
  { path: "/settings/account", element: <AccountSettingsPage /> },
  { path: "/documents/:noteId", element: <DocumentRoute /> },
  { path: "/settings/members", element: <MemberSettingsPage /> },
];
