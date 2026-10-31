import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoadingState } from "../shared/ui/LoadingState";

const PublicSharePage = lazy(() => import("../features/sharing/PublicSharePage").then(module => ({ default: module.PublicSharePage })));
const PublicSitePage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.PublicSitePage })));
const SitePreviewPage = lazy(() => import("../features/sites/PublicSitePage").then((module) => ({ default: module.SitePreviewPage })));
const PublicSheetForm = lazy(() => import("../features/sheets/PublicSheetForm").then(m => ({default:m.PublicSheetForm})));
const AcceptInvitationPage = lazy(() => import("../features/members/AcceptInvitationPage").then(module => ({ default: module.AcceptInvitationPage })));
const ConfirmOwnershipPage = lazy(() => import("../features/members/ConfirmOwnershipPage").then(module => ({ default: module.ConfirmOwnershipPage })));

function publicPage(children: ReactNode, label: string, variant?: "editor") {
  return <Suspense fallback={<LoadingState label={label} variant={variant} />}>{children}</Suspense>;
}

const siteFallback = <div className="site-reader-status"><LoadingState label="正在打开站点…" variant="editor" /></div>;

/** Public delivery and invitation routes intentionally live outside workspace chrome. */
export const publicRoutes: RouteObject[] = [
  { path: "/forms/:token", element: publicPage(<PublicSheetForm />, "正在打开表单…") },
  { path: "/share/:shareToken/:noteId?", element: publicPage(<PublicSharePage />, "正在打开分享…", "editor") },
  { path: "/s/:slug/*", element: <Suspense fallback={siteFallback}><PublicSitePage /></Suspense> },
  { path: "/sites/:siteId/preview/*", element: <RequireAuth><Suspense fallback={siteFallback}><SitePreviewPage /></Suspense></RequireAuth> },
  { path: "/invite/:token", element: publicPage(<AcceptInvitationPage />, "正在打开邀请…") },
  { path: "/invitations/accept", element: publicPage(<AcceptInvitationPage />, "正在打开邀请…") },
  { path: "/ownership-transfer/:token", element: publicPage(<ConfirmOwnershipPage />, "正在打开邀请…") },
  { path: "/ownership-transfers/confirm", element: publicPage(<ConfirmOwnershipPage />, "正在打开邀请…") },
];
