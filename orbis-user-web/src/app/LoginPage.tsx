import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Orbit } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../shared/api/api-client";
import { login, setup } from "../shared/auth/auth-api";
import { authStore } from "../shared/auth/auth-store";
import { Button } from "../shared/ui/Button";
import { TextInput } from "../shared/ui/TextInput";
import { showToast } from "../shared/ui/Toast";

function authErrorMessage(error: unknown, isSetup: boolean): string {
  if (!(error instanceof ApiError)) return "暂时无法连接 Orbis API，请稍后重试。";
  if (error.code === "INVALID_CREDENTIALS") return "邮箱或密码不正确。";
  if (error.code === "SYSTEM_ALREADY_INITIALIZED") return "系统已经完成初始化，请返回登录。";

  if (error.code === "VALIDATION_ERROR" || error.status === 422) {
    const data = error.data as { errors?: unknown } | null;
    const issues = Array.isArray(data?.errors) ? data.errors : [];
    for (const issue of issues) {
      if (!issue || typeof issue !== "object") continue;
      const { field, code } = issue as { field?: unknown; code?: unknown };
      if (field === "body.email") return code === "MISSING" ? "请输入邮箱。" : "邮箱格式不正确，请检查后重试。";
      if (field === "body.password") {
        if (code === "MISSING" || (!isSetup && code === "STRING_TOO_SHORT")) return "请输入密码。";
        if (code === "STRING_TOO_LONG") return "密码不能超过 256 位。";
        return isSetup ? "密码至少需要 8 位。" : "请检查密码后重试。";
      }
      if (field === "body.display_name") return code === "MISSING" ? "请输入显示名称。" : "请检查显示名称后重试。";
    }
    return "请检查填写的信息后重试。";
  }
  return error.message || "暂时无法连接 Orbis API，请稍后重试。";
}

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
    onError: (error) => {
      showToast({
        title: isSetup && error instanceof ApiError && error.code === "SYSTEM_ALREADY_INITIALIZED"
          ? "无需重复初始化"
          : isSetup ? "初始化失败" : "登录失败",
        description: authErrorMessage(error, isSetup),
        tone: "danger",
      });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = isSetup && !displayName.trim() ? "请输入显示名称。"
      : !email.trim() ? "请输入邮箱。"
        : !password ? "请输入密码。"
          : isSetup && password.length < 8 ? "密码至少需要 8 位。"
            : null;
    if (validationMessage) {
      showToast({ title: "请检查填写的信息", description: validationMessage, tone: "danger" });
      return;
    }
    authMutation.mutate();
  }

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
        <form className="auth-form" aria-labelledby="auth-heading" onSubmit={handleSubmit} noValidate>
          {isSetup ? <TextInput label="显示名称" placeholder="你的名字" value={displayName} required onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" /> : null}
          <TextInput label="邮箱" type="email" placeholder="name@example.com" value={email} required onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          <TextInput label="密码" type="password" placeholder={isSetup ? "至少 8 位" : "输入密码"} value={password} required minLength={isSetup ? 8 : 1} onChange={(event) => setPassword(event.target.value)} autoComplete={isSetup ? "new-password" : "current-password"} />
          <Button type="submit" variant="primary" className="auth-submit" disabled={authMutation.isPending}>{authMutation.isPending ? "正在连接…" : isSetup ? "创建并进入工作空间" : "登录 Orbis"}<ArrowRight aria-hidden="true" size={16} /></Button>
        </form>
        <div className="auth-card-footer">{isSetup ? <>系统已初始化？ <Link to="/login">返回登录</Link></> : <>首次部署？ <Link to="/setup">初始化管理员账号</Link></>}</div>
      </section>
      <footer className="auth-footer">记录 · 连接 · 生长</footer>
    </main>
  );
}
