import { workspaceTopbarClassName } from "./workspace-chrome";
import { Button } from "@orbis/ui/button";
import { ArrowLeft, ArrowRight, Search } from "../../shared/ui/icons";
import { useNavigate } from "react-router-dom";
import { useSearchPalette } from "../search/search-palette-context";
import { WorkspaceAccountMenu } from "./WorkspaceAccountMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function WorkspaceTopbar({ disabled = false }: { disabled?: boolean }) {
  const navigate = useNavigate();
  const { isOpen, openSearch } = useSearchPalette();

  return (
    <header className={workspaceTopbarClassName} inert={disabled ? true : undefined}>
      <WorkspaceSwitcher />
      <div className="workspace-topbar-center absolute left-1/2 flex w-[min(480px,40vw)] -translate-x-1/2 items-center gap-4 max-[768px]:static max-[768px]:w-auto max-[768px]:flex-1 max-[768px]:translate-x-0">
        <div className="workspace-history flex gap-1 max-[768px]:hidden">
          <Button type="button" size="icon" aria-label="返回上一页" onClick={() => navigate(-1)} variant="ghost"><ArrowLeft size={18} /></Button>
          <Button type="button" size="icon" aria-label="前往下一页" onClick={() => navigate(1)} variant="ghost"><ArrowRight size={18} /></Button>
        </div>
        <Button type="button" className="workspace-global-search workspace-search-launcher min-w-0 flex-1 justify-start max-[768px]:w-full max-[768px]:min-w-[70px] [&>kbd]:flex-none [&>kbd]:text-xs max-[768px]:[&>kbd]:hidden" aria-label="全局搜索" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch()} variant="outline">
          <Search size={16} className="flex-none" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">全局搜索</span><kbd aria-hidden="true">⌘ K</kbd>
        </Button>
      </div>
      <WorkspaceAccountMenu />
    </header>
  );
}
