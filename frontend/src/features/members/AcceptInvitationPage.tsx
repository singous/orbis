import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, UserPlus } from "../../shared/ui/icons";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "../../shared/api/api-client";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { Button, buttonVariants } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { TextInput } from "../../shared/ui/TextInput";
import { authStore } from "../../shared/auth/auth-store";
import { listWorkspaces } from "../workspace/api";
import { showToast } from "../../shared/ui/Toast";
import { acceptInvitation, inspectInvitation } from "./api";

export function AcceptInvitationPage() {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const invitationToken = new URLSearchParams(location.hash.slice(1)).get("token") || token || searchParams.get("token") || "";
  return <InvitationSession key={invitationToken} invitationToken={invitationToken} />;
}

function InvitationSession({ invitationToken }: { invitationToken: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const auth = useOptionalAuthRequest();
  const inspection = useQuery({ queryKey: ["invitation-inspection", location.key], queryFn: () => inspectInvitation(invitationToken), enabled: Boolean(invitationToken), retry: false });
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const accept = useMutation({
    mutationFn: async () => {
      const generation = authStore.getState().sessionGeneration;
      const result = await acceptInvitation({ token: invitationToken, ...(auth ? {} : { password, display_name: displayName }) }, auth);
      return { result, generation };
    },
    onSuccess: async ({ result, generation }) => {
      let current = authStore.getState();
      if (!active.current || current.sessionGeneration !== generation) return;
      const credentials = result.session ? { accessToken: result.session.access_token, refreshToken: result.session.refresh_token }
        : current.accessToken && current.refreshToken ? { accessToken: current.accessToken, refreshToken: current.refreshToken } : null;
      if (!credentials) return;
      let workspace = null;
      try {
        const choices = await listWorkspaces({ ...credentials, onTokenRefresh: (accessToken, refreshToken) => { credentials.accessToken = accessToken; credentials.refreshToken = refreshToken; }, onUnauthorized: () => {} });
        workspace = choices.items.find(item => item.id === result.member.workspace_id) ?? null;
      } catch { if (active.current) showToast({ title: "已加入工作空间", description: "空间列表暂时不可用，登录后可重新选择。", tone: "success" }); }
      current = authStore.getState();
      if (!active.current || current.sessionGeneration !== generation) return;
      current.setSession({ ...credentials, user: result.user, workspace });
      navigate("/documents", { replace: true });
    },
  });
  const error = accept.error as ApiError | null;

  function submit(event: FormEvent) {
    event.preventDefault();
    accept.mutate();
  }

  return (
    <main className="orbis-auth-layout grid min-h-screen place-items-center bg-[var(--surface-app)] p-5">
      <section className="orbis-auth-card w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface-content)] p-7 shadow-[var(--shadow-pop)]">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-inverse)] text-[var(--text-oninverse)]">
          {accept.isSuccess ? <Check aria-hidden="true" size={20} /> : <UserPlus aria-hidden="true" size={20} />}
        </div>
        {accept.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">已加入工作空间</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">成员身份已激活。请登录后进入 Orbis 云文档。</p>
            <Link to={auth ? "/documents" : "/login"} className={`${buttonVariants({ variant: "primary" })} mt-6 w-full`}>{auth ? "进入文档中心" : "前往登录"}</Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">接受成员邀请</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{auth ? "使用当前登录账号确认加入受邀工作空间。" : "首次加入需要设置显示名称和密码。已有账号请先登录，再重新打开邀请链接。"}</p>
            <form className="mt-6 grid gap-4" onSubmit={submit}>
              {inspection.data ? <p>工作空间：{inspection.data.workspace_name} · {inspection.data.email}</p> : null}
              {inspection.isError ? <StatusMessage tone="error" title="邀请不可用">{inspection.error.message}</StatusMessage> : null}
              {!auth && !inspection.data?.account_exists ? <><TextInput label="显示名称" value={displayName} required onChange={(event) => setDisplayName(event.target.value)} /><TextInput label="设置密码" type="password" minLength={1} value={password} required onChange={(event) => setPassword(event.target.value)} /></> : null}
              {!auth && inspection.data?.account_exists ? <Link to="/login" state={{ from: location.pathname + location.search + location.hash }}>登录受邀账号后继续</Link> : null}
              {error ? <StatusMessage tone="error" title="无法接受邀请">{error.code === "INVITATION_ACCOUNT_AUTHENTICATION_REQUIRED" ? "该邮箱已有账号，请先登录对应账号。" : error.message}</StatusMessage> : null}
              <Button type="submit" variant="primary" className="mt-2 w-full" disabled={!invitationToken || inspection.isPending || inspection.isError || (!auth && Boolean(inspection.data?.account_exists)) || accept.isPending}>确认加入</Button>
            </form>
            <div className="mt-5 text-center text-xs text-[var(--muted)]"><Link className="font-semibold text-[var(--text-primary)]" to="/login">返回登录</Link></div>
          </>
        )}
      </section>
    </main>
  );
}
