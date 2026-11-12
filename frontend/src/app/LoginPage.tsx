import { Spinner } from "@orbis/ui/spinner";
import { reportError } from "../shared/api/request-feedback";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@orbis/ui/input";
import { OrbisLogo } from "../shared/ui/OrbisLogo";
import { ArrowRight } from "../shared/ui/icons";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { AuthIllustration } from "../features/auth/AuthIllustration";
import { login, setup } from "../shared/auth/auth-api";
import { authStore } from "../shared/auth/auth-store";
import { Button } from "@orbis/ui/button";
import { showToast } from "../shared/ui/Toast";

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
    onError: reportError,
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
    <main data-ui="auth" className="grid min-h-dvh grid-cols-1 bg-card text-foreground min-[901px]:grid-cols-[minmax(0,56%)_minmax(0,44%)] forced-colors:grid-cols-1">
      <section data-auth-content className="flex min-h-dvh w-full min-w-0 max-w-160 flex-col justify-self-center px-6 pt-6 pb-5 min-[481px]:px-8 min-[481px]:pt-7 min-[481px]:pb-6 min-[1101px]:max-w-none min-[1101px]:px-[clamp(32px,4.4vw,72px)] min-[1101px]:pt-9 min-[1101px]:pb-7" aria-label={isSetup ? "账号初始化" : "账号登录"}>
        <header className="flex items-center justify-between gap-5">
          <Link to="/login" className="inline-flex flex-none leading-none text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="Orbis">
            <OrbisLogo variant="horizontal" size={36} />
          </Link>
          <span className="hidden text-xs leading-[18px] text-muted-foreground min-[481px]:inline min-[901px]:hidden min-[1101px]:inline">你的知识工作空间</span>
        </header>
        <div className="grid min-w-0 flex-1 items-center justify-items-center pt-11 pb-10 min-[481px]:py-10">
          <section className="w-full max-w-100 min-[901px]:max-[1100px]:max-w-90" aria-labelledby="auth-heading">
            <div className="mb-7 min-[481px]:mb-8">
              <p className="mb-2.5 text-sm leading-5 text-muted-foreground">{isSetup ? "从一个新空间开始" : "又见面啦"}</p>
              <h1 id="auth-heading" className="m-0 text-[clamp(28px,2.4vw,32px)] leading-[1.35] font-[650] tracking-[-.035em]">{isSetup ? "开启你的 Orbis" : "欢迎回到 Orbis"}</h1>
              <p className="mt-3 text-sm leading-[1.7] text-muted-foreground">{isSetup ? "创建所有者账号，把想法和计划放进来。" : "登录后，接着整理你的好想法。"}</p>
            </div>
            <form className="grid gap-[18px] min-[481px]:gap-5" aria-labelledby="auth-heading" onSubmit={handleSubmit} noValidate>
              {isSetup ? <label className="grid gap-2 text-sm font-medium">显示名称<Input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="你的名字" autoComplete="name" required /></label> : null}
              <label className="grid gap-2 text-sm font-medium">邮箱<Input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" required /></label>
              <label className="grid gap-2 text-sm font-medium">密码<Input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder={isSetup ? "至少 12 字节" : "输入密码"} minLength={isSetup ? 12 : 1} autoComplete={isSetup ? "new-password" : "current-password"} required /></label>
              <Button type="submit" className="auth-submit mt-2 w-full" disabled={authMutation.isPending} focusableWhenDisabled={authMutation.isPending} aria-busy={authMutation.isPending || undefined}>{authMutation.isPending ? <Spinner aria-hidden="true" /> : null}{authMutation.isPending ? "正在连接…" : isSetup ? "创建并进入工作空间" : "登录 Orbis"}<ArrowRight aria-hidden="true" /></Button>
            </form>
            <div className="mt-7 pt-6 text-center text-[13px] leading-[22px] text-muted-foreground">{isSetup ? <>系统已初始化？ <Link className="ms-1.5 font-medium text-foreground hover:underline hover:underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/login">返回登录</Link></> : <>首次部署？ <Link className="ms-1.5 font-medium text-foreground hover:underline hover:underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" to="/setup">初始化管理员账号</Link></>}</div>
          </section>
        </div>
        <footer className="text-center text-xs leading-[18px] text-muted-foreground">让学习和工作，轻一点。</footer>
      </section>
      <aside className="sticky top-0 hidden h-dvh min-h-160 min-w-0 flex-col overflow-hidden bg-ob-auth-showcase px-8 pt-[clamp(36px,5vh,64px)] pb-8 text-ob-auth-showcase-foreground min-[901px]:flex min-[1101px]:px-[clamp(28px,3.7vw,60px)] forced-colors:hidden" aria-label="关于 Orbis">
        <div>
          <p className="mb-[18px] text-[11px] leading-[18px] font-medium tracking-[.13em]">A LITTLE SPACE FOR BIG IDEAS</p>
          <h2 className="m-0 text-[clamp(34px,3.2vw,48px)] leading-[1.25] font-[650] tracking-[-.035em]">给好想法，<br />留个好位置。</h2>
          <p className="mt-[18px] text-[15px] leading-[1.9] text-ob-auth-showcase-muted">课堂笔记、工作计划，<br />还有那些突然冒出来的灵感。</p>
        </div>
        <AuthIllustration />
      </aside>
    </main>
  );
}
