import { withRequestFeedback } from "../../shared/api/request-feedback";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { logout } from "../../shared/auth/auth-api";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { UserMenu } from "./UserMenu";

/** Both hosts share identity, permission checks and sign-out behavior. */
export function WorkspaceAccountMenu({ variant = "topbar" }: { variant?: "topbar" | "rail" }) {
  const navigate = useNavigate();
  const auth = useAuthRequest();
  const user = useStore(authStore, state => state.user);
  const workspace = useStore(authStore, state => state.workspace);
  return <UserMenu user={user} workspace={workspace} variant={variant} onLogout={() => {
    void (async () => {
      const credentialID = authStore.getState().credentialID;
      let signedOut = false;
      const context = { ...auth, canNotify: () => authStore.getState().credentialID === credentialID || (signedOut && authStore.getState().credentialID === null) };
      await withRequestFeedback(context, async scoped => {
        try { await logout(scoped); }
        finally {
          if (authStore.getState().credentialID === credentialID) {
            signedOut = true;
            authStore.getState().clearSession();
            navigate("/login", { replace: true });
          }
        }
      }).catch(() => {});
    })();
  }} />;
}
