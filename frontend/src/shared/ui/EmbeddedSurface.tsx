import { ArrowLeft, Maximize2, RotateCcw } from "lucide-react";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ActionButton } from "./ActionButton";
import { Tooltip } from "./Tooltip";
import "./embedded-surface.css";

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
    target?.appendChild(host);
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

  return <div ref={placeholder} className="embed-placeholder" style={{ height }} data-orbis-embedded-editor>
    {createPortal(<section
      ref={surface}
      className={`embed-surface embed-${kind}${expanded ? " is-expanded" : ""}`}
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
        event.stopPropagation();
      }}
      onCopy={event => event.stopPropagation()}
      onCut={event => event.stopPropagation()}
      onPaste={event => event.stopPropagation()}
    >
      <header className="embed-heading">
        {expanded && <ActionButton className="embed-back" onPress={() => expand(false)}><ArrowLeft size={16} />返回文档</ActionButton>}
        <span className="embed-label" title={label}>{label}</span>
        <div className="embed-actions">{actions}
          {!expanded && <Tooltip label="全屏展开"><ActionButton aria-label="全屏展开" onPress={() => expand(true)}><Maximize2 size={16} /></ActionButton></Tooltip>}
        </div>
      </header>
      <div className="embed-content">{children}</div>
      {!expanded && <footer className="embed-resize-bar">
        <div
          className="embed-resize-handle"
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
        ><span /></div>
        {customHeight !== null && <Tooltip label="恢复默认高度"><ActionButton aria-label="恢复默认高度" onPress={() => changeHeight(null)}><RotateCcw size={13} /></ActionButton></Tooltip>}
      </footer>}
    </section>, host)}
  </div>;
}
