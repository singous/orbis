import { ActionButton } from "../../shared/ui/ActionButton";
import type { ReactNode } from "react";
import { ChevronsLeft, X } from "../../shared/ui/icons";
import type { WorkspaceSidebarConfig } from "./workspace-sidebar-config";

export function WorkspaceSidebar({ config, hidden, onCollapse, onClose, resizeHandle }: {
  config: WorkspaceSidebarConfig;
  hidden: boolean;
  onCollapse: () => void;
  onClose: () => void;
  resizeHandle?: ReactNode;
}) {
  const id = config.id ?? "workspace-sidebar";
  const separateTitle = config.titlePlacement === "below-header";
  return <section id={id} className="workspace-sidebar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden visible opacity-100 [transition:opacity_var(--sidebar-transition-duration)_ease,visibility_0s] in-[.sidebar-collapsed]:invisible in-[.sidebar-collapsed]:pointer-events-none in-[.sidebar-collapsed]:opacity-0 in-[.sidebar-collapsed]:[transition:opacity_var(--sidebar-transition-duration)_ease,visibility_0s_var(--sidebar-transition-duration)] motion-reduce:transition-none" aria-label={config.label ?? "侧栏"} aria-hidden={hidden ? true : undefined} inert={hidden ? true : undefined}>
    <div className="workspace-sidebar-inner flex h-full min-h-0 w-[calc(var(--sidebar-width)-2*var(--navigation-frame-border-width))] flex-col max-[768px]:w-full">
      <header className="workspace-sidebar-header flex min-h-14 items-center gap-[7px] pt-3 pr-[13px] pb-2 pl-3">
        {config.leadingActions}
        {separateTitle ? <div className="workspace-sidebar-header-spacer flex-1" /> : <div className="workspace-sidebar-title min-w-0 flex-1 [&_h2]:m-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-[-0.025em]">{config.title}</div>}
        {config.actions ? <div className="workspace-sidebar-actions flex flex-none items-center">{config.actions}</div> : null}
        <ActionButton type="button" className="sidebar-collapse grid size-(--ob-control-height-sm) place-items-center text-(--ob-page-muted-foreground) hover:bg-(--ob-item-hover-bg) hover:text-ob-foreground max-[768px]:hidden" data-sidebar-toggle="collapse" aria-label={config.collapseLabel ?? "收起侧栏"} aria-expanded="true" aria-controls={id} onClick={onCollapse}><ChevronsLeft size={18} /></ActionButton>
        <ActionButton type="button" className="sidebar-mobile-close hidden size-(--ob-control-height-sm) place-items-center text-(--ob-page-muted-foreground) hover:bg-(--ob-item-hover-bg) hover:text-ob-foreground max-[768px]:grid" aria-label="关闭侧栏" onClick={onClose}><X size={18} /></ActionButton>
      </header>
      {separateTitle ? <div className="workspace-sidebar-heading min-w-0 px-3 pb-3">{config.title}</div> : null}
      <div className="workspace-sidebar-body flex min-h-0 flex-1 flex-col overflow-hidden">{config.content}</div>
    </div>
    {resizeHandle}
  </section>;
}
