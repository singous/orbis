import { useMutation } from "@tanstack/react-query";
import { Envelope, Lock, Person } from "@gravity-ui/icons";
import { InputGroup } from "@heroui/react/input-group";
import { Label } from "@heroui/react/label";
import { TextField } from "@heroui/react/textfield";
import { OrbisLogo } from "../shared/ui/OrbisLogo";
import { ArrowRight } from "../shared/ui/icons";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../shared/api/api-client";
import { login, setup } from "../shared/auth/auth-api";
import { authStore } from "../shared/auth/auth-store";
import { Button } from "../shared/ui/Button";
import { showToast } from "../shared/ui/Toast";

function authErrorMessage(error: unknown, isSetup: boolean): string {
  if (!(error instanceof ApiError)) return "暂时无法连接 Orbis API，请稍后重试。";
  if (error.code === "INVALID_CREDENTIALS") return "邮箱或密码不正确。";
  if (error.code === "SETUP_COMPLETED") return "系统已经完成初始化，请返回登录。";

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
        return isSetup ? "密码需要 12 至 128 字节。" : "请检查密码后重试。";
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
        title: isSetup && error instanceof ApiError && error.code === "SETUP_COMPLETED"
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
          : isSetup && (new TextEncoder().encode(password).length < 12 || new TextEncoder().encode(password).length > 128) ? "密码需要 12 至 128 字节。"
            : null;
    if (validationMessage) {
      showToast({ title: "请检查填写的信息", description: validationMessage, tone: "danger" });
      return;
    }
    authMutation.mutate();
  }

  return (
    <main className="auth-layout">
      <section className="auth-content" aria-label={isSetup ? "账号初始化" : "账号登录"}>
        <header className="auth-header">
          <Link to="/login" className="auth-brand" aria-label="Orbis">
            <OrbisLogo variant="horizontal" size={36} />
          </Link>
          <span className="auth-header-caption">你的知识工作空间</span>
        </header>
        <div className="auth-main">
          <section className="auth-card" aria-labelledby="auth-heading">
            <div className="auth-card-heading">
              <p className="auth-card-kicker">{isSetup ? "从一个新空间开始" : "又见面啦"}</p>
              <h1 id="auth-heading">{isSetup ? "开启你的 Orbis" : "欢迎回到 Orbis"}</h1>
              <p>{isSetup ? "创建所有者账号，把想法和计划放进来。" : "登录后，接着整理你的好想法。"}</p>
            </div>
            <form className="auth-form" aria-labelledby="auth-heading" onSubmit={handleSubmit} noValidate>
              {isSetup ? <TextField className="auth-field" fullWidth value={displayName} onChange={setDisplayName} isRequired validationBehavior="aria">
                <Label>显示名称</Label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix aria-hidden="true"><Person className="auth-input-icon" /></InputGroup.Prefix>
                  <InputGroup.Input placeholder="你的名字" autoComplete="name" required />
                </InputGroup>
              </TextField> : null}
              <TextField className="auth-field" fullWidth type="email" value={email} onChange={setEmail} isRequired validationBehavior="aria">
                <Label>邮箱</Label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix aria-hidden="true"><Envelope className="auth-input-icon" /></InputGroup.Prefix>
                  <InputGroup.Input placeholder="name@example.com" autoComplete="email" required />
                </InputGroup>
              </TextField>
              <TextField className="auth-field" fullWidth type="password" value={password} onChange={setPassword} isRequired validationBehavior="aria">
                <Label>密码</Label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix aria-hidden="true"><Lock className="auth-input-icon" /></InputGroup.Prefix>
                  <InputGroup.Input placeholder={isSetup ? "至少 12 字节" : "输入密码"} minLength={isSetup ? 12 : 1} autoComplete={isSetup ? "new-password" : "current-password"} required />
                </InputGroup>
              </TextField>
              <Button isPending={authMutation.isPending} type="submit" variant="primary" className="auth-submit" disabled={authMutation.isPending}>{authMutation.isPending ? "正在连接…" : isSetup ? "创建并进入工作空间" : "登录 Orbis"}<ArrowRight aria-hidden="true" size={16} /></Button>
            </form>
            <div className="auth-card-footer">{isSetup ? <>系统已初始化？ <Link to="/login">返回登录</Link></> : <>首次部署？ <Link to="/setup">初始化管理员账号</Link></>}</div>
          </section>
        </div>
        <footer className="auth-footer">让学习和工作，轻一点。</footer>
      </section>
      <aside className="auth-showcase" aria-label="关于 Orbis">
        <div className="auth-showcase-copy">
          <p className="auth-showcase-eyebrow">A LITTLE SPACE FOR BIG IDEAS</p>
          <h2>给好想法，<br />留个好位置。</h2>
          <p className="auth-showcase-description">课堂笔记、工作计划，<br />还有那些突然冒出来的灵感。</p>
        </div>
        <div className="auth-showcase-art" aria-hidden="true">
          <img src="/images/auth-orbit.webp" alt="" width={1254} height={1254} decoding="async" />
        </div>
        <p className="auth-showcase-footer">STUDY. WORK. YOUR WAY.</p>
      </aside>
    </main>
  );
}
