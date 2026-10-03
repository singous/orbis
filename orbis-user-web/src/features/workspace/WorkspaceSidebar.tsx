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
  return <section id={id} className="workspace-sidebar" aria-label={config.label ?? "侧栏"} aria-hidden={hidden ? true : undefined} inert={hidden ? true : undefined}>
    <div className="workspace-sidebar-inner">
      <header className="workspace-sidebar-header">
        <div className="workspace-sidebar-title">{config.title}</div>
        {config.actions ? <div className="workspace-sidebar-actions">{config.actions}</div> : null}
        <ActionButton type="button" className="sidebar-collapse" data-sidebar-toggle="collapse" aria-label={config.collapseLabel ?? "收起侧栏"} aria-expanded="true" aria-controls={id} onClick={onCollapse}><ChevronsLeft size={18} /></ActionButton>
        <ActionButton type="button" className="sidebar-mobile-close" aria-label="关闭侧栏" onClick={onClose}><X size={18} /></ActionButton>
      </header>
      <div className="workspace-sidebar-body">{config.content}</div>
    </div>
    {resizeHandle}
  </section>;
}
