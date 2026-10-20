import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "./auth-store";

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const location = useLocation();

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
