import { buttonVariants, Button } from "@orbis/ui/button";
import { RiFileCopy2Fill, RiFileCopy2Line } from "@remixicon/react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { X } from "../../shared/ui/icons";
import { workspaceRailClassName } from "./workspace-chrome";
import { resolveWorkspaceArea } from "./workspace-areas";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { WorkspaceAccountMenu } from "./WorkspaceAccountMenu";

export function BusinessRail({ collapsed, onExpand, onClose, children }: { collapsed: boolean; onExpand: () => void; onClose?: () => void; children?: ReactNode }) {
  const { pathname } = useLocation();
  const area = resolveWorkspaceArea(pathname).id;
  const active = area === "home" || area === "documents" || area === "search";
  const Icon = active ? RiFileCopy2Fill : RiFileCopy2Line;

  return (
    <aside className={workspaceRailClassName} aria-label="应用导航">
      {onClose ? <Button className="rail-mobile-close absolute start-5 top-3" type="button" size="icon-sm" aria-label="关闭侧栏" onClick={onClose} variant="ghost"><X aria-hidden="true" /></Button> : null}
      <WorkspaceSwitcher />
      <nav className="workspace-business-nav flex flex-col items-center gap-7" aria-label="业务板块">
        <Link to="/documents" aria-label="在线文档" aria-current={active ? "page" : undefined} className={buttonVariants({ variant: "ghost", className: "rail-action h-[60px] w-[52px] flex-col gap-1.5" })} onClick={event => {
          if (active && collapsed && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            onExpand();
          }
        }}>
          <Icon aria-hidden="true" className="size-[22px]" /><span className="text-[11px]">文档</span>
        </Link>
        {children}
      </nav>
      <div className="rail-bottom mt-auto pt-7"><WorkspaceAccountMenu /></div>
    </aside>
  );
}
