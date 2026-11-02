import { ArrowLeft, Maximize2, RotateCcw } from "@orbis/ui/icons";
import { cn } from "@orbis/ui/cn";
import { Portal } from "@orbis/ui/portal";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@orbis/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@orbis/ui/tooltip";

const MIN_HEIGHT = 220;
const MAX_HEIGHT = 960;
const RESIZE_STEP = 40;
const clampHeight = (height: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));

/** 保持同一个 portal 容器，展开时只移动 DOM，不重建编辑器和未提交的草稿。 */
export function EmbeddedSurface({
  label, surfaceKey, kind, children, actions, defaultHeight = 440,
  expanded: controlledExpanded, onExpandedChange,
}: {
  label: string;
  surfaceKey: string;
  kind: "board" | "table";
  children: ReactNode;
  actions?: ReactNode;
  defaultHeight?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const placeholder = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const resize = useRef<{ y: number; height: number } | null>(null);
  const [host] = useState(() => document.createElement("div"));
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const storageKey = kind === "table" ? `orbis.embed-height:${surfaceKey}` : null;
  const [customHeight, setCustomHeight] = useState<number | null>(() => {
    if (!storageKey) return null;
    try {
      const value = Number(sessionStorage.getItem(storageKey));
      return value >= MIN_HEIGHT && value <= MAX_HEIGHT ? value : null;
    } catch { return null; }
  });
  const height = customHeight ?? clampHeight(defaultHeight);
  function changeHeight(value: number | null) {
    setCustomHeight(value === null ? null : clampHeight(value));
    if (!storageKey) return;
    try {
      if (value === null) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, String(clampHeight(value)));
    } catch { /* 浏览器存储受限时仍可在当前页面调整尺寸。 */ }
  }
  function expand(value: boolean) {
    if (value) returnFocus.current = document.activeElement as HTMLElement;
    setLocalExpanded(value);
    onExpandedChange?.(value);
  }

  useLayoutEffect(() => {
    const target = expanded ? document.body : placeholder.current;
    // 浏览器移动已连接的 DOM 时会清零内部滚动；在新容器布局完成后恢复。
    const scrollPositions = Array.from(host.querySelectorAll<HTMLElement>("*")).filter(element => element.scrollTop || element.scrollLeft).map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    target?.appendChild(host);
    for (const { element, top, left } of scrollPositions) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
    if (expanded) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // 文档保持原位；其余浮层仍可通过 body portal 正常获得焦点。
      const root = placeholder.current?.closest<HTMLElement>("#root");
      const previousInert = root?.inert ?? false;
      if (root) root.inert = true;
      surface.current?.querySelector<HTMLButtonElement>(".embed-back")?.focus({ preventScroll: true });
      return () => {
        document.body.style.overflow = previousOverflow;
        if (root) root.inert = previousInert;
      };
    }
    if (returnFocus.current) (returnFocus.current.isConnected ? returnFocus.current : surface.current?.querySelector<HTMLElement>('[aria-label="全屏展开"]'))?.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [expanded, host]);
  useLayoutEffect(() => () => host.remove(), [host]);

  return <div ref={placeholder} className="embed-placeholder relative my-4 min-w-0" style={{ height }} data-orbis-embedded-editor>
    <Portal container={host}><section
      ref={surface}
      className={cn("embed-surface flex min-w-0 flex-col bg-card text-sm text-foreground", `embed-${kind}`, expanded ? "is-expanded fixed inset-0 z-[calc(var(--ob-z-dialog)-1)] isolate h-dvh rounded-none border-0 border-none border-current" : "relative rounded-md border border-border in-[.workspace-shell]:border-border focus-within:border-ring")}
      style={expanded ? undefined : { height }}
      aria-label={label}
      role="region"
      contentEditable={false}
      data-orbis-embedded-editor
      onKeyDown={event => {
        // 浮层、输入框和画布先处理自己的 Escape；下一次才退出展开。
        if (event.key === "Escape" && expanded && !event.defaultPrevented &&
          event.target instanceof HTMLElement && surface.current?.contains(event.target) &&
          !event.target.closest('input,textarea,[contenteditable="true"],[role="dialog"],[role="menu"]')) {
          event.preventDefault();
          expand(false);
        }
        if (event.key !== "F6") event.stopPropagation();
      }}
      onCopy={event => event.stopPropagation()}
      onCut={event => event.stopPropagation()}
      onPaste={event => event.stopPropagation()}
    >
      <header className={cn("embed-heading flex flex-none items-center gap-3 [@media(max-width:640px)]:gap-1.5", !expanded && kind === "table" ? "h-0 min-h-0 p-0" : "px-2.5 py-1 [@media(max-width:640px)]:px-1.5", expanded ? "min-h-12 border-b border-border" : kind === "board" && "min-h-9")}>
        {expanded && <Button className="embed-back" variant="ghost" size="sm" onClick={event => { event.stopPropagation(); expand(false); }}><ArrowLeft size={16} />返回文档</Button>}
        <span className={cn("embed-label min-w-0 truncate text-xs leading-5 text-(--muted-foreground)", !expanded && kind === "table" && "hidden")} title={label}>{label}</span>
        <div className={cn("embed-actions ml-auto flex flex-none items-center gap-1", !expanded && kind === "table" && "absolute top-1.5 right-1.5 z-[21]")}>{actions}
          {!expanded && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="全屏展开" onClick={event => { event.stopPropagation(); expand(true); }} />}><Maximize2 /></TooltipTrigger><TooltipContent>全屏展开</TooltipContent></Tooltip>}
        </div>
      </header>
      <div className="embed-content relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      {!expanded && <footer className="embed-resize-bar relative h-2.5 flex-none">
        <div
          className="embed-resize-handle group absolute -inset-y-[3px] inset-x-8 grid touch-none cursor-ns-resize place-items-center focus-visible:outline-2 focus-visible:outline-ring"
          role="separator" tabIndex={0} aria-label="调整嵌入高度" aria-orientation="horizontal"
          aria-valuemin={MIN_HEIGHT} aria-valuemax={MAX_HEIGHT} aria-valuenow={Math.round(height)}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            resize.current = { y: event.clientY, height };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (resize.current) changeHeight(resize.current.height + event.clientY - resize.current.y);
          }}
          onPointerUp={() => { resize.current = null; }}
          onPointerCancel={() => { resize.current = null; }}
          onLostPointerCapture={() => { resize.current = null; }}
          onDoubleClick={() => changeHeight(null)}
          onKeyDown={event => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              changeHeight(height + (event.key === "ArrowUp" ? -RESIZE_STEP : RESIZE_STEP));
            } else if (event.key === "Home") { event.preventDefault(); changeHeight(null); }
          }}
        ><span className="h-1 w-12 rounded-sm bg-border in-[.workspace-shell]:bg-border group-hover:bg-(--muted-foreground)" /></div>
        {customHeight !== null && <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="absolute right-0 bottom-0" aria-label="恢复默认高度" onClick={event => { event.stopPropagation(); changeHeight(null); }} />}><RotateCcw /></TooltipTrigger><TooltipContent>恢复默认高度</TooltipContent></Tooltip>}
      </footer>}
    </section></Portal>
  </div>;
}
