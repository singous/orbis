import { Toast as Primitive } from "@base-ui/react/toast";
import { useEffect, type ReactNode } from "react";
import { cn } from "../cn";
import { controlFocus } from "../internal/focus";
import { ToolbarScopeBoundary } from "../internal/toolbar-scope";
import { CircleCheck, OctagonAlert, TriangleAlert, Info, X } from "../icons";
import { usePortalTheme } from "../internal/use-portal-theme";

type ToastOptions = { id?: string; title: ReactNode; description?: ReactNode; tone?: "default" | "accent" | "success" | "warning" | "danger"; timeout?: number };
type ToastManager = { add: (options: ToastOptions) => string; update: (id: string, options: Partial<Omit<ToastOptions, "id">>) => void; close: (id: string) => void; clear: () => void };
type Engine = ReturnType<typeof Primitive.createToastManager>;
const managers = new WeakMap<ToastManager, { engine: Engine; mount: () => void; unmount: () => void }>();
let nextId = 0;

function createToastManager(): ToastManager {
  const engine = Primitive.createToastManager();
  const pending = new Map<string, ToastOptions>();
  let mounted = false;
  const nativeOptions = ({ tone, ...options }: ToastOptions) => ({ ...options, type: tone });
  const manager: ToastManager = {
    add(options) {
      const id = options.id ?? `ob-toast-${++nextId}`;
      if (mounted) engine.add({ ...nativeOptions(options), id });
      else pending.set(id, options);
      return id;
    },
    update(id, options) {
      if (mounted) { const { tone, ...updates } = options; engine.update(id, { ...updates, ...(tone === undefined ? {} : { type: tone }) }); }
      else { const previous = pending.get(id); if (previous) pending.set(id, { ...previous, ...options }); }
    },
    close(id) { pending.delete(id); engine.close(id); },
    clear() { pending.clear(); engine.close(); },
  };
  managers.set(manager, {
    engine,
    mount() { mounted = true; for (const [id, options] of pending) engine.add({ ...nativeOptions(options), id }); pending.clear(); },
    unmount() { mounted = false; },
  });
  return manager;
}

type ToastProviderProps = { manager: ToastManager; children?: ReactNode; timeout?: number; limit?: number; closeLabel?: string; className?: string; notificationRole?: "dialog" | "alertdialog" };
function ToastProvider({ manager, timeout = 5000, limit = 3, closeLabel = "关闭通知", notificationRole = "dialog", children, className }: ToastProviderProps) {
  const registered = managers.get(manager)!;
  const { anchor, theme, portalStyle } = usePortalTheme();
  // 子 Provider 先订阅事件，再重放挂载前产生的通知。
  useEffect(() => { registered.mount(); return registered.unmount; }, [registered]);
  return <><span hidden ref={anchor} /><Primitive.Provider toastManager={registered.engine} timeout={timeout} limit={limit}>
    {children}
    <ToolbarScopeBoundary><Primitive.Portal data-theme={theme} style={portalStyle}>
      <Primitive.Viewport data-slot="ob-toast-viewport" aria-label="通知" role="region" aria-live="off" className={cn("fixed end-4 bottom-4 z-(--ob-z-toast) flex w-90 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none", className)}>
        <ToastList closeLabel={closeLabel} notificationRole={notificationRole} />
      </Primitive.Viewport>
    </Primitive.Portal></ToolbarScopeBoundary>
  </Primitive.Provider></>;
}
function ToastList({ closeLabel, notificationRole }: { closeLabel: string; notificationRole: "dialog" | "alertdialog" }) {
  const { toasts } = Primitive.useToastManager();
  return toasts.map(toast => {
    const Icon = toast.type === "success" ? CircleCheck : toast.type === "danger" ? OctagonAlert : toast.type === "warning" ? TriangleAlert : Info;
    const toneClass = toast.type === "success" ? "text-ob-toast-success" : toast.type === "danger" ? "text-ob-toast-danger" : toast.type === "warning" ? "text-ob-toast-warning" : toast.type === "accent" ? "text-ob-primary" : "text-ob-popover-foreground";
    return <Primitive.Root key={toast.id} toast={toast} role={notificationRole} data-slot="ob-toast" className="relative flex items-start gap-1.5 rounded-ob-xl border border-ob-border bg-ob-popover px-4 py-3 pe-11 text-ob-popover-foreground shadow-lg outline-none transition-opacity duration-(--ob-motion-popover) data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:hidden">
      <span aria-hidden="true" data-slot="ob-toast-indicator" className={cn("grid size-6 shrink-0 place-items-center", toneClass)}><Icon size={16} /></span>
      <Primitive.Content role={notificationRole === "alertdialog" ? "alert" : "status"} aria-atomic="true" className="min-w-0 flex-1 self-center wrap-anywhere"><Primitive.Title className={cn("text-sm leading-5 font-medium", toneClass)} />{toast.description ? <Primitive.Description className="mt-1 text-sm text-ob-muted-foreground" /> : null}</Primitive.Content>
      {/* 列表逐条完整展开，关闭按钮始终可见，也应始终对辅助技术可见。 */}
      <Primitive.Close aria-hidden={false} aria-label={closeLabel} className={cn("absolute end-2 top-2 grid size-8 place-items-center rounded-ob-sm text-ob-muted-foreground hover:bg-ob-accent", controlFocus)}><X aria-hidden="true" size={14} /></Primitive.Close>
    </Primitive.Root>;
  });
}
export { createToastManager, ToastProvider };
export type { ToastManager, ToastOptions, ToastProviderProps };
