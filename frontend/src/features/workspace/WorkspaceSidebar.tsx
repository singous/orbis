import { Button } from "@orbis/ui/button";
import { cn } from "@orbis/ui/cn";
import type { ReactNode } from "react";
import { X } from "../../shared/ui/icons";
import type { WorkspaceSidebarConfig } from "./workspace-sidebar-config";

export function WorkspaceSidebar({ config, hidden, onClose, resizeHandle }: {
  config: WorkspaceSidebarConfig;
  hidden: boolean;
  onClose: () => void;
  resizeHandle?: ReactNode;
}) {
  const id = config.id ?? "workspace-sidebar";
  const separateTitle = config.titlePlacement === "below-header";
  return <section id={id} className="workspace-sidebar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label={config.label ?? "侧栏"} aria-hidden={hidden || undefined} inert={hidden || undefined}>
    <div className="workspace-sidebar-inner flex h-full min-h-0 w-(--sidebar-width) flex-col max-[768px]:w-full">
      <header className={cn("workspace-sidebar-header flex min-h-14 items-center gap-2 px-4", separateTitle ? "min-[768px]:ps-12" : "min-[768px]:min-h-[104px] min-[768px]:pt-16")}>
        {config.leadingActions}
        {separateTitle ? <div className="flex-1" /> : <div className="workspace-sidebar-title min-w-0 flex-1 [&_h2]:text-base [&_h2]:font-semibold">{config.title}</div>}
        {config.actions ? <div className="workspace-sidebar-actions flex flex-none items-center">{config.actions}</div> : null}
        <Button type="button" className="sidebar-mobile-close hidden max-[768px]:inline-flex" size="icon" aria-label="关闭侧栏" onClick={onClose} variant="ghost"><X aria-hidden="true" size={18} /></Button>
      </header>
      {separateTitle ? <div className="workspace-sidebar-heading min-w-0 px-3 pb-3">{config.title}</div> : null}
      <div className="workspace-sidebar-body flex min-h-0 flex-1 flex-col overflow-hidden">{config.content}</div>
    </div>
    {resizeHandle}
  </section>;
}
