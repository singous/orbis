import { useMutation } from "@tanstack/react-query";
import { ArrowRight, BookOpen, LogIn, Sparkles } from "lucide-react";
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
      <div className="auth-glass-orbit" aria-hidden="true" />

      <div className="auth-shell">
        <header className="auth-header">
          <Link to="/login" className="auth-brand" aria-label="Orbis">
            <span className="auth-brand-mark">O</span>
            <span className="auth-brand-word">ORBIS</span>
          </Link>
          <div className="auth-window-dots" aria-hidden="true"><span /><span /><span /></div>
        </header>

        <section className="auth-intro" aria-labelledby="auth-story-heading">
          <div className="auth-eyebrow"><Sparkles aria-hidden="true" size={13} />云端文档，自主可控</div>
          <h1 id="auth-story-heading">把想法写成<br /><span>可持续的知识资产</span></h1>
          <p>Orbis 为个人与小团队提供安静、清晰的在线文档空间。层级组织、结构化编辑与自动保存，在同一处自然发生。</p>
          <div className="auth-intro-note"><span aria-hidden="true" />专注写作，知识自然沉淀</div>
        </section>

        <section className="auth-form-panel" aria-labelledby="auth-heading">
          <div className="auth-card">
            <div className="auth-card-icon"><BookOpen aria-hidden="true" size={20} /></div>
            <div className="auth-card-heading">
              <div className="auth-card-kicker">{isSetup ? "首次启动" : "欢迎回来"}</div>
              <h2 id="auth-heading">{isSetup ? "初始化 Orbis" : "登录工作空间"}</h2>
              <p>{isSetup ? "创建唯一的所有者账号与默认私人工作空间。" : "继续编辑你的笔记本和在线文档。"}</p>
            </div>
            <form className="auth-form" aria-labelledby="auth-heading" onSubmit={handleSubmit}>
              {isSetup ? <TextInput label="显示名称" placeholder="你的名字" value={displayName} required onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /> : null}
              <TextInput label="邮箱" type="email" placeholder="name@example.com" value={email} required onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              <TextInput label="密码" type="password" placeholder={isSetup ? "至少 8 位" : "输入密码"} value={password} required minLength={isSetup ? 8 : 1} onChange={(event) => setPassword(event.target.value)} autoComplete={isSetup ? "new-password" : "current-password"} />
              {error ? <StatusMessage tone="error" title={isSetup && error.code === "SYSTEM_ALREADY_INITIALIZED" ? "无需重复初始化" : "无法继续"}>{errorMessage}{isSetup && error.code === "SYSTEM_ALREADY_INITIALIZED" ? <div className="mt-2"><Link className="font-semibold underline" to="/login">返回登录</Link></div> : null}</StatusMessage> : null}
              <Button type="submit" variant="primary" className="auth-submit" disabled={authMutation.isPending} icon={isSetup ? <ArrowRight aria-hidden="true" size={16} /> : <LogIn aria-hidden="true" size={16} />}>{authMutation.isPending ? "正在连接…" : isSetup ? "创建并进入工作空间" : "登录 Orbis"}</Button>
            </form>
            <div className="auth-card-footer">{isSetup ? <>系统已初始化？ <Link to="/login">返回登录</Link></> : <>首次部署？ <Link to="/setup">初始化管理员账号 <ArrowRight aria-hidden="true" size={13} /></Link></>}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
