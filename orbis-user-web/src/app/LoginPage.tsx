import { useMutation } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Check, LogIn, Sparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../shared/api/api-client";
import { login, setup } from "../shared/auth/auth-api";
import { authStore } from "../shared/auth/auth-store";
import { Button } from "../shared/ui/Button";
import { StatusMessage } from "../shared/ui/StatusMessage";
import { TextInput } from "../shared/ui/TextInput";

export function LoginPage({ mode }: { mode: "login" | "setup" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useStore(authStore, (state) => state.setSession);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const isSetup = mode === "setup";

  const authMutation = useMutation({
    mutationFn: () => isSetup ? setup({ email, password, display_name: displayName }) : login({ email, password }),
    onSuccess: (response) => {
      setSession({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        user: response.user,
        workspace: response.workspace,
      });
      const requested = (location.state as { from?: string } | null)?.from;
      navigate(requested || "/documents", { replace: true });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    authMutation.mutate();
  }

  const error = authMutation.error as ApiError | null;
  const errorMessage = error?.code === "INVALID_CREDENTIALS"
    ? "邮箱或密码不正确。"
    : error?.code === "SYSTEM_ALREADY_INITIALIZED"
      ? "系统已经完成初始化，请返回登录。"
      : error?.status === 422
        ? "请检查表单，密码至少需要 8 位。"
        : error?.message || "暂时无法连接 Orbis API，请稍后重试。";

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="relative z-10 flex h-full flex-col">
          <Link to="/login" className="flex items-center gap-3 text-white"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-sm font-black text-black">O</span><span className="text-sm font-semibold tracking-wide">ORBIS</span></Link>
          <div className="my-auto max-w-xl py-16">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60"><Sparkles aria-hidden="true" size={12} />Cloud documents, in your control</div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-[-0.055em] text-white lg:text-7xl">把想法写成<br /><span className="text-white/40">可持续的知识资产。</span></h1>
            <p className="mt-7 max-w-lg text-sm leading-7 text-white/55">Orbis 为个人与小团队提供安静、清晰的在线文档空间。层级组织、结构化编辑与自动保存，在同一处自然发生。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {["结构化块编辑", "毫秒级自动保存", "清晰文档树"].map((item) => <div key={item} className="rounded-xl border border-white/10 bg-white/[0.035] p-4 text-xs text-white/65"><Check aria-hidden="true" size={14} className="mb-6 text-[#8a7cf6]" />{item}</div>)}
          </div>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="w-full max-w-[420px]">
          <div className="mb-9 grid h-12 w-12 place-items-center rounded-2xl bg-black text-white"><BookOpen aria-hidden="true" size={20} /></div>
          <div className="mb-8"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#6757f5]">{isSetup ? "First launch" : "Welcome back"}</div><h2 className="text-3xl font-semibold tracking-[-0.04em]">{isSetup ? "初始化 Orbis" : "登录工作空间"}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{isSetup ? "创建唯一的所有者账号与默认私人工作空间。" : "继续编辑你的文集和在线文档。"}</p></div>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            {isSetup ? <TextInput label="显示名称" placeholder="你的名字" value={displayName} required onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /> : null}
            <TextInput label="邮箱" type="email" placeholder="name@example.com" value={email} required onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            <TextInput label="密码" type="password" placeholder={isSetup ? "至少 8 位" : "输入密码"} value={password} required minLength={isSetup ? 8 : 1} onChange={(event) => setPassword(event.target.value)} autoComplete={isSetup ? "new-password" : "current-password"} />
            {error ? <StatusMessage tone="error" title={isSetup && error.code === "SYSTEM_ALREADY_INITIALIZED" ? "无需重复初始化" : "无法继续"}>{errorMessage}{isSetup && error.code === "SYSTEM_ALREADY_INITIALIZED" ? <div className="mt-2"><Link className="font-semibold underline" to="/login">返回登录</Link></div> : null}</StatusMessage> : null}
            <Button type="submit" variant="primary" className="mt-2 h-11 w-full rounded-xl" disabled={authMutation.isPending} icon={isSetup ? <ArrowRight aria-hidden="true" size={16} /> : <LogIn aria-hidden="true" size={16} />}>{authMutation.isPending ? "正在连接…" : isSetup ? "创建并进入工作空间" : "登录 Orbis"}</Button>
          </form>
          <div className="mt-7 border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">{isSetup ? <>系统已初始化？ <Link className="font-semibold text-black" to="/login">返回登录</Link></> : <>首次部署？ <Link className="inline-flex items-center gap-1 font-semibold text-black" to="/setup">初始化管理员账号 <ArrowRight aria-hidden="true" size={13} /></Link></>}</div>
        </div>
      </section>
    </main>
  );
}
