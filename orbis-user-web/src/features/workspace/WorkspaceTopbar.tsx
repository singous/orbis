import { ActionButton } from "../../shared/ui/ActionButton";
import { ArrowLeft, ArrowRight, Search } from "../../shared/ui/icons";
import { useNavigate } from "react-router-dom";
import { useSearchPalette } from "../search/search-palette-context";
import { WorkspaceAccountMenu } from "./WorkspaceAccountMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function WorkspaceTopbar({ disabled = false }: { disabled?: boolean }) {
  const navigate = useNavigate();
  const { isOpen, openSearch } = useSearchPalette();

  return (
    <header className="workspace-topbar" inert={disabled ? true : undefined}>
      <WorkspaceSwitcher />
      <div className="workspace-topbar-center">
        <div className="workspace-history">
          <ActionButton type="button" aria-label="返回上一页" onClick={() => navigate(-1)}><ArrowLeft size={18} /></ActionButton>
          <ActionButton type="button" aria-label="前往下一页" onClick={() => navigate(1)}><ArrowRight size={18} /></ActionButton>
        </div>
        <ActionButton type="button" className="workspace-global-search workspace-search-launcher" aria-label="全局搜索" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch()}>
          <Search size={16} aria-hidden="true" /><span>搜索当前空间…</span><kbd>⌘ K</kbd>
        </ActionButton>
      </div>
      <WorkspaceAccountMenu />
    </header>
  );
}
