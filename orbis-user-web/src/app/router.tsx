import { Navigate, createBrowserRouter } from "react-router-dom";

import { NotesWorkspace } from "../features/notes/NotesWorkspace";
import { RequireAuth } from "../shared/auth/RequireAuth";
import { LoginPage } from "./LoginPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/notes" replace />,
  },
  {
    path: "/login",
    element: <LoginPage mode="login" />,
  },
  {
    path: "/register",
    element: <LoginPage mode="register" />,
  },
  {
    path: "/notes",
    element: (
      <RequireAuth>
        <NotesWorkspace />
      </RequireAuth>
    ),
  },
]);
