import { workspaceTopbarClassName } from "./workspace-chrome";
import { Button } from "@orbis/ui/button";
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
    <header className={workspaceTopbarClassName} inert={disabled ? true : undefined}>
      <WorkspaceSwitcher />
      <div className="workspace-topbar-center absolute left-1/2 flex w-[min(480px,40vw)] -translate-x-1/2 items-center gap-4 max-[768px]:static max-[768px]:w-auto max-[768px]:flex-1 max-[768px]:translate-x-0">
        <div className="workspace-history flex gap-1.5 max-[768px]:hidden [&>button]:grid [&>button]:size-(--ob-control-height-sm) [&>button]:place-items-center [&>button]:text-(--ob-page-muted-foreground) [&>button:hover]:bg-(--ob-item-selected-bg) [&>button:hover]:text-ob-foreground">
          <ActionButton type="button" aria-label="返回上一页" onClick={() => navigate(-1)}><ArrowLeft size={18} /></ActionButton>
          <ActionButton type="button" aria-label="前往下一页" onClick={() => navigate(1)}><ArrowRight size={18} /></ActionButton>
        </div>
        <Button appearance="unstyled" type="button" className="workspace-global-search workspace-search-launcher flex h-(--ob-control-height-sm) min-w-0 flex-1 max-[768px]:min-w-[70px] max-[768px]:w-full [&>kbd]:flex-none [&>kbd]:text-ob-caption [&>kbd]:font-ob-sans [&>kbd]:text-(--ob-page-muted-foreground) max-[768px]:[&>kbd]:hidden items-center justify-start gap-2 rounded-ob-lg border border-ob-border bg-ob-card px-2 text-start text-sm text-ob-muted-foreground hover:bg-ob-accent" aria-label="全局搜索" aria-haspopup="dialog" aria-expanded={isOpen} onClick={() => openSearch()}>
          <Search size={16} className="flex-none" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">全局搜索</span><kbd aria-hidden="true">⌘ K</kbd>
        </Button>
      </div>
      <WorkspaceAccountMenu />
    </header>
  );
}
