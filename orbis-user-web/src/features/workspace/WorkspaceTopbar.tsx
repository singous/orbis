import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function WorkspaceTopbar({ disabled = false }: { disabled?: boolean }) {
  const navigate = useNavigate();
  const user = useStore(authStore, (state) => state.user);
  const workspace = useStore(authStore, (state) => state.workspace);
  const [keyword, setKeyword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!disabled && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [disabled]);

  function search(event: FormEvent) {
    event.preventDefault();
    navigate(`/documents/search${keyword.trim() ? `?q=${encodeURIComponent(keyword.trim())}` : ""}`);
  }

  function logout() {
    authStore.getState().clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <header className="workspace-topbar" inert={disabled ? true : undefined}>
      <WorkspaceSwitcher />
      <div className="workspace-topbar-center">
        <div className="workspace-history">
          <button type="button" aria-label="返回上一页" onClick={() => navigate(-1)}><ArrowLeft size={17} /></button>
          <button type="button" aria-label="前往下一页" onClick={() => navigate(1)}><ArrowRight size={17} /></button>
        </div>
        <form className="workspace-global-search" role="search" aria-label="全局搜索" onSubmit={search}>
          <Search size={16} aria-hidden="true" />
          <input ref={inputRef} aria-label="全局搜索" type="search" placeholder="搜索文档…" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <kbd>⌘ K</kbd>
        </form>
      </div>
      <UserMenu user={user} workspace={workspace} onLogout={logout} />
    </header>
  );
}
