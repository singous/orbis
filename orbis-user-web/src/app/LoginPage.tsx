import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Orbit } from "lucide-react";
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
      <header className="auth-header">
        <Link to="/login" className="auth-brand" aria-label="Orbis">
          <span className="auth-brand-mark"><Orbit aria-hidden="true" size={23} strokeWidth={1.8} /></span>
          <span>Orbis</span>
        </Link>
        <span className="auth-header-caption">你的知识工作空间</span>
      </header>

      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-card-heading">
          <div className="auth-card-kicker">{isSetup ? "从这里开始" : "欢迎回来"}</div>
          <h1 id="auth-heading">{isSetup ? "初始化 Orbis" : "登录工作空间"}</h1>
          <p>{isSetup ? "创建所有者账号，开启你的私人工作空间。" : "继续记录想法，整理和分享你的知识。"}</p>
        </div>
        <form className="auth-form" aria-labelledby="auth-heading" onSubmit={handleSubmit}>
          {isSetup ? <TextInput label="显示名称" placeholder="你的名字" value={displayName} required onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /> : null}
          <TextInput label="邮箱" type="email" placeholder="name@example.com" value={email} required onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          <TextInput label="密码" type="password" placeholder={isSetup ? "至少 8 位" : "输入密码"} value={password} required minLength={isSetup ? 8 : 1} onChange={(event) => setPassword(event.target.value)} autoComplete={isSetup ? "new-password" : "current-password"} />
          {error ? <StatusMessage tone="error" title={isSetup && error.code === "SYSTEM_ALREADY_INITIALIZED" ? "无需重复初始化" : "无法继续"}>{errorMessage}{isSetup && error.code === "SYSTEM_ALREADY_INITIALIZED" ? <div className="mt-2"><Link className="font-semibold underline" to="/login">返回登录</Link></div> : null}</StatusMessage> : null}
          <Button type="submit" variant="primary" className="auth-submit" disabled={authMutation.isPending}>{authMutation.isPending ? "正在连接…" : isSetup ? "创建并进入工作空间" : "登录 Orbis"}<ArrowRight aria-hidden="true" size={16} /></Button>
        </form>
        <div className="auth-card-footer">{isSetup ? <>系统已初始化？ <Link to="/login">返回登录</Link></> : <>首次部署？ <Link to="/setup">初始化管理员账号</Link></>}</div>
      </section>
      <footer className="auth-footer">记录 · 连接 · 生长</footer>
    </main>
  );
}
