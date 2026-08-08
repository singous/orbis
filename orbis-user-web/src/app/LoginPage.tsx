import { useMutation } from "@tanstack/react-query";
import { Brain, LogIn, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../shared/api/api-client";
import { login, register } from "../shared/auth/auth-api";
import { authStore } from "../shared/auth/auth-store";
import { Button } from "../shared/ui/Button";
import { StatusMessage } from "../shared/ui/StatusMessage";
import { TextInput } from "../shared/ui/TextInput";

export function LoginPage({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const setSession = useStore(authStore, (state) => state.setSession);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const authMutation = useMutation({
    mutationFn: async () => {
      if (mode === "register") {
        return register({ email, password, display_name: displayName || undefined });
      }
      return login({ email, password });
    },
    onSuccess: (response) => {
      setSession({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        user: response.user,
      });
      navigate("/notes", { replace: true });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    authMutation.mutate();
  }

  const error = authMutation.error as ApiError | null;
  const isRegister = mode === "register";
  const errorMessage =
    error?.detail === "Invalid email or password"
      ? "邮箱或密码不正确。"
      : error?.detail === "Email is already registered"
        ? "该邮箱已注册。"
        : "请确认后端服务已启动后重试。";

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--app-bg)] px-4">
      <section className="w-full max-w-md rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-[var(--text)] text-white">
            <Brain aria-hidden="true" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold">Orbis 笔记</div>
            <div className="text-sm text-[var(--muted)]">
              {isRegister ? "创建你的知识工作台身份" : "登录你的笔记工作台"}
            </div>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          {isRegister ? (
            <TextInput
              label="显示名称"
              placeholder="你的名字"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
            />
          ) : null}
          <TextInput
            label="邮箱"
            type="email"
            placeholder="请输入邮箱"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <TextInput
            label="密码"
            type="password"
            placeholder="至少 8 位"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
          />

          {error ? (
            <StatusMessage tone="error" title="认证失败">
              {errorMessage}
            </StatusMessage>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={authMutation.isPending}
            icon={isRegister ? <UserPlus aria-hidden="true" size={16} /> : <LogIn aria-hidden="true" size={16} />}
          >
            {authMutation.isPending ? "处理中..." : isRegister ? "创建账号" : "登录"}
          </Button>
        </form>

        <div className="mt-5 text-center text-sm text-[var(--muted)]">
          {isRegister ? (
            <>
              已有账号？{" "}
              <Link className="font-medium text-[var(--accent-strong)]" to="/login">
                去登录
              </Link>
            </>
          ) : (
            <>
              还没有账号？{" "}
              <Link className="font-medium text-[var(--accent-strong)]" to="/register">
                创建账号
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
