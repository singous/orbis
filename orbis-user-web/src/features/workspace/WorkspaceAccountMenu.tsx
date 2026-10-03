import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { UserMenu } from "./UserMenu";

/** Both hosts share identity, permission checks and sign-out behavior. */
export function WorkspaceAccountMenu({ variant = "topbar" }: { variant?: "topbar" | "rail" }) {
  const navigate = useNavigate();
  const user = useStore(authStore, state => state.user);
  const workspace = useStore(authStore, state => state.workspace);
  return <UserMenu user={user} workspace={workspace} variant={variant} onLogout={() => {
    authStore.getState().clearSession();
    navigate("/login", { replace: true });
  }} />;
}
