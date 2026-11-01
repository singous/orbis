import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Button } from "@orbis/ui/button";
import { ArrowDown, ArrowUp, Trash2, X } from "../../shared/ui/icons";
import { DialogContent } from "../../shared/ui/Dialog";
import { controlTones } from "../../shared/ui/control-styles";
import { cn } from "@orbis/ui/cn";

type SiteManagementAppearance = "standalone" | "editor" | "create";
const AppearanceContext = createContext<SiteManagementAppearance>("standalone");

/** 创建弹窗与管理页共享表单内容；外观差异不参与草稿或发布状态。 */
export function SiteManagementScope({ appearance, children }: { appearance: SiteManagementAppearance; children: ReactNode }) {
  return <AppearanceContext.Provider value={appearance}>{children}</AppearanceContext.Provider>;
}
export function useSiteManagementAppearance() { return useContext(AppearanceContext); }

// 非标准像素间距沿用既有站点表单与预览布局，字体和控件继续使用平台尺寸。
export function SiteField({ variant = "form", className, ...props }: ComponentProps<"label"> & { variant?: "form" | "source" }) {
  return <label {...props} className={cn(
    variant === "source" ? "grid gap-1.5 text-sm font-normal text-ob-muted-foreground" : "flex min-w-0 flex-col gap-2 text-sm font-medium [&_input]:min-w-0 [&_input]:font-normal [&_textarea]:min-w-0 [&_textarea]:font-normal [&_textarea]:leading-[1.7] [&_small]:text-xs [&_small]:font-normal [&_small]:text-ob-muted-foreground",
    className,
  )} />;
}

export function SiteSectionHeading({ title, description, actions }: { title: ReactNode; description: ReactNode; actions?: ReactNode }) {
  const appearance = useSiteManagementAppearance();
  return <div className={cn("flex items-center justify-between gap-3.5", appearance === "editor" ? "mb-[23px]" : "mb-[25px]")}>
    <div><h2 className={cn("mb-[7px] flex items-center gap-2 text-base text-ob-foreground", appearance === "editor" ? "font-medium" : "font-semibold")}>{title}</h2><p className="text-xs text-ob-muted-foreground">{description}</p></div>
    {actions}
  </div>;
}

export function SitePagination({ hasPrevious, hasNext, onPrevious, onNext, children }: {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  children: ReactNode;
}) {
  return <div className="flex items-center justify-end gap-5 py-4 text-xs text-ob-muted-foreground [&_button]:p-[5px] [&_button:disabled]:cursor-default [&_button:disabled]:opacity-35">
    <SiteActionButton disabled={!hasPrevious} onClick={onPrevious}>上一页</SiteActionButton>
    <span>{children}</span>
    <SiteActionButton disabled={!hasNext} onClick={onNext}>下一页</SiteActionButton>
  </div>;
}

export function SiteDialogActions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("mt-[25px] flex justify-end gap-2.5", className)} />;
}

export function SiteInfoPanel({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("rounded-[10px] border border-ob-border bg-(--ob-item-hover-bg) px-4 py-3.5 forced-colors:bg-ob-card", className)} />;
}

/** 站点行操作的统一命中区与原生按钮布局。 */
export function SiteActionButton({ className, ...props }: ComponentProps<"button">) {
  return <Button appearance="unstyled" {...props} className={cn("rounded-ob-xl border-0 p-0 pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)", controlTones.ghost, className)} />;
}

/** 来源顺序和手动目录复用相同的重排操作，父级保留实际集合更新。 */
export function SiteReorderControls({ appearance, first, last, upLabel, downLabel, removeLabel, onMove, onRemove }: {
  appearance: "source" | "navigation";
  first: boolean;
  last: boolean;
  upLabel: string;
  downLabel: string;
  removeLabel: string;
  onMove: (direction: number) => void;
  onRemove: () => void;
}) {
  const source = appearance === "source";
  const size = source ? 14 : 16;
  const RemoveIcon = source ? Trash2 : X;
  const buttonClass = source
    ? "inline-flex size-(--ob-control-height-sm) items-center justify-center text-ob-muted-foreground enabled:hover:bg-(--ob-item-hover-bg) enabled:hover:text-ob-foreground pointer-coarse:size-(--ob-control-height-touch)"
    : "inline-block h-auto w-auto text-start text-ob-foreground enabled:hover:bg-ob-secondary";
  return <div className={source ? "flex gap-[2px]" : "flex flex-col gap-[3px]"}>
    <SiteActionButton className={buttonClass} disabled={first} aria-label={upLabel} onClick={() => onMove(-1)}><ArrowUp size={size} /></SiteActionButton>
    <SiteActionButton className={buttonClass} disabled={last} aria-label={downLabel} onClick={() => onMove(1)}><ArrowDown size={size} /></SiteActionButton>
    <SiteActionButton className={buttonClass} aria-label={removeLabel} onClick={onRemove}><RemoveIcon size={size} /></SiteActionButton>
  </div>;
}

/** 宽表单与发布预览采用同一窗口边距，内部滚动由公共 Dialog 管理。 */
export function SiteWideDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  const creating = useSiteManagementAppearance() === "create";
  return <DialogContent {...props} className={cn("w-[calc(100vw-40px)]", creating ? "max-w-[860px] p-[30px] max-[560px]:p-6" : "max-w-[1040px] p-7", className)} />;
}

export function SiteNotice({ title, description, icon, className, descriptionClassName }: {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  className?: string;
  descriptionClassName?: string;
}) {
  return <SiteInfoPanel className={cn(icon && "flex items-start gap-2.5", className)}>
    {icon}<div><strong className="text-xs">{title}</strong><p className={cn("mt-[5px] text-xs text-ob-muted-foreground", descriptionClassName)}>{description}</p></div>
  </SiteInfoPanel>;
}
