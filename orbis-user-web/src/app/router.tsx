import { Navigate, createBrowserRouter } from "react-router-dom";

import { DocumentCenterPage } from "../features/documents/DocumentCenterPage";
import { DocumentEditorPage } from "../features/documents/DocumentEditorPage";
import { NotebookPage } from "../features/documents/NotebookPage";
import { AcceptInvitationPage } from "../features/members/AcceptInvitationPage";
import { ConfirmOwnershipPage } from "../features/members/ConfirmOwnershipPage";
import { MemberSettingsPage } from "../features/members/MemberSettingsPage";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoginPage } from "./LoginPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/documents" replace />,
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
    path: "/documents",
    element: (
      <RequireAuth>
        <DocumentCenterPage />
      </RequireAuth>
    ),
  },
  {
    path: "/collections/:collectionId",
    element: <RequireAuth><NotebookPage /></RequireAuth>,
  },
  {
    path: "/documents/:noteId",
    element: <RequireAuth><DocumentEditorPage /></RequireAuth>,
  },
  {
    path: "/settings/members",
    element: <RequireAuth><MemberSettingsPage /></RequireAuth>,
  },
  { path: "*", element: <Navigate to="/documents" replace /> },
]);
