import { useMutation } from "@tanstack/react-query";
import { Check, UserPlus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { TextInput } from "../../shared/ui/TextInput";
import { acceptInvitation, type MemberAuth } from "./api";

export function AcceptInvitationPage() {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  const invitationToken = token || searchParams.get("token") || "";
  const accessToken = useStore(authStore, (state) => state.accessToken);
  const refreshToken = useStore(authStore, (state) => state.refreshToken);
  const onTokenRefresh = useStore(authStore, (state) => state.setAccessToken);
  const onUnauthorized = useStore(authStore, (state) => state.clearSession);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const auth = useMemo<MemberAuth | null>(
    () => accessToken ? { accessToken, refreshToken, onTokenRefresh, onUnauthorized } : null,
    [accessToken, refreshToken, onTokenRefresh, onUnauthorized],
  );
  const accept = useMutation({
    mutationFn: () => acceptInvitation(
      { token: invitationToken, ...(auth ? {} : { password, display_name: displayName }) },
      auth,
    ),
  });
  const error = accept.error as ApiError | null;

  function submit(event: FormEvent) {
    event.preventDefault();
    accept.mutate();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f3f1] p-5">
      <section className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-7 shadow-xl shadow-black/5">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-black text-white">
          {accept.isSuccess ? <Check aria-hidden="true" size={20} /> : <UserPlus aria-hidden="true" size={20} />}
        </div>
        {accept.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">已加入工作空间</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">成员身份已激活。请登录后进入 Orbis 云文档。</p>
            <Link to={auth ? "/documents" : "/login"}><Button className="mt-6 w-full" variant="primary">{auth ? "进入文档中心" : "前往登录"}</Button></Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">接受成员邀请</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{auth ? "使用当前登录账号确认加入默认私人工作空间。" : "首次加入需要设置显示名称和密码。已有账号请先登录，再重新打开邀请链接。"}</p>
            <form className="mt-6 grid gap-4" onSubmit={submit}>
              {!auth ? <><TextInput label="显示名称" value={displayName} required onChange={(event) => setDisplayName(event.target.value)} /><TextInput label="设置密码" type="password" minLength={8} value={password} required onChange={(event) => setPassword(event.target.value)} /></> : null}
              {error ? <StatusMessage tone="error" title="无法接受邀请">{error.code === "INVITATION_ACCOUNT_AUTHENTICATION_REQUIRED" ? "该邮箱已有账号，请先登录对应账号。" : error.message}</StatusMessage> : null}
              <Button type="submit" variant="primary" className="mt-2 w-full" disabled={!invitationToken || accept.isPending}>确认加入</Button>
            </form>
            <div className="mt-5 text-center text-xs text-[var(--muted)]"><Link className="font-semibold text-black" to="/login">返回登录</Link></div>
          </>
        )}
      </section>
    </main>
  );
}
