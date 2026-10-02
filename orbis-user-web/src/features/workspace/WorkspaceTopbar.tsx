import { InputGroup } from "@heroui/react/input-group";
import { ActionButton } from "../../shared/ui/ActionButton";
import { ArrowLeft, ArrowRight, Search } from "../../shared/ui/icons";
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
    navigate(`/search${keyword.trim() ? `?q=${encodeURIComponent(keyword.trim())}` : ""}`);
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
          <ActionButton type="button" aria-label="返回上一页" onClick={() => navigate(-1)}><ArrowLeft size={18} /></ActionButton>
          <ActionButton type="button" aria-label="前往下一页" onClick={() => navigate(1)}><ArrowRight size={18} /></ActionButton>
        </div>
        <form className="workspace-global-search" role="search" aria-label="全局搜索" onSubmit={search}>
          <InputGroup fullWidth className="workspace-search-group orbis-compact-search"><InputGroup.Prefix><Search size={16} aria-hidden="true" /></InputGroup.Prefix>
          <InputGroup.Input ref={inputRef} aria-label="全局搜索" type="search" placeholder="搜索当前空间…" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
          <InputGroup.Suffix><kbd>⌘ K</kbd></InputGroup.Suffix></InputGroup>
        </form>
      </div>
      <UserMenu user={user} workspace={workspace} onLogout={logout} />
    </header>
  );
}
