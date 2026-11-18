import { DialogContent, DialogTitle } from "@orbis/ui/dialog";
import { Input } from "@orbis/ui/input";
import { cloneElement, createContext, useContext, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from "react";
import { cn } from "../cn";
import { FileText, Search } from "../icons";

type CommandPreset = "workspace" | "reader";
const CommandPresentation = createContext<CommandPreset>("workspace");
const readerFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ob-reader-accent)";

type CommandPopupProps = Omit<ComponentProps<typeof DialogContent>, "className"> & { preset: CommandPreset; title: string };

/** 搜索的布局与命名属于展示层；Dialog 的会话、退出和焦点恢复仍由调用方管理。 */
export function CommandPopup({ preset, title, children, ...props }: CommandPopupProps) {
  return <CommandPresentation value={preset}><DialogContent {...props} showCloseButton={false} className="max-h-[85dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
    <DialogTitle className="sr-only">{title}</DialogTitle>
    {children}
  </DialogContent></CommandPresentation>;
}

type CommandInputProps = Omit<ComponentProps<typeof Input>, "className" | "role" | "aria-controls" | "aria-activedescendant" | "aria-expanded" | "children"> & { listId: string; activeId?: string; children?: ReactNode };
export function CommandInput({ listId, activeId, children, ...props }: CommandInputProps) {
  return <div className="flex items-center gap-3 border-b border-border p-3">
    <Search aria-hidden="true" size={18} className="shrink-0 text-muted-foreground" />
    <Input {...props} role="combobox" aria-controls={listId} aria-expanded="true" aria-activedescendant={activeId} className="min-w-0 flex-1" />
    {children}
  </div>;
}

type CommandListProps = Omit<ComponentProps<"div">, "role" | "className"> & { layout?: "results" | "categories" };
export function CommandList({ layout = "results", ...props }: CommandListProps) {
  const reader = useContext(CommandPresentation) === "reader";
  return <div {...props} role="listbox" className={reader
    ? "site-reader-search-results min-h-[210px] max-h-[min(56vh,510px)] overflow-y-auto p-2 [@media(max-width:800px)]:max-h-[calc(100dvh-150px)]"
    : layout === "categories" ? "grid grid-cols-2 gap-2 max-[560px]:grid-cols-1" : "grid gap-1"} />;
}

type CommandResultProps = {
  element: ReactElement<{ className?: string; children?: ReactNode; role?: string; "aria-selected"?: boolean }>;
  selected: boolean;
  icon: ComponentType<ComponentProps<typeof FileText>>;
  title: ReactNode;
  path: ReactNode;
  excerpt?: ReactNode;
  metadata?: ReactNode;
};
export function CommandResult({ element, selected, icon: Icon, title, path, excerpt, metadata }: CommandResultProps) {
  const reader = useContext(CommandPresentation) === "reader";
  const Path = reader ? "small" : "span";
  // 浅色选中背景上的 muted 文字仅 4.48:1，选中项改用已有的 item 前景色。
  const workspaceSecondary = selected ? "text-accent-foreground" : "text-muted-foreground";
  const secondary = reader ? "truncate text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) group-aria-selected/search-result:text-(--ob-reader-muted-on-soft)" : cn("truncate text-xs leading-[18px]", workspaceSecondary);
  // 仅补展示属性和内容，保留 Link/Button 本身及调用方的事件、ref、tabIndex 和可访问名称。
  return cloneElement(element, {
    role: "option",
    "aria-selected": selected,
    className: cn(reader
      ? `group/search-result grid h-auto w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-2.5 rounded-[9px] border-0 border-current bg-transparent px-3 py-[11px] text-left whitespace-normal text-(--ob-reader-muted) aria-selected:bg-(--ob-reader-accent-soft) aria-selected:text-(--ob-reader-accent) ${selected ? "is-active" : ""} ${readerFocus}`
      : "flex w-full min-w-0 items-start gap-3 rounded-[9px] border border-transparent bg-transparent p-3 text-start text-foreground hover:bg-accent aria-selected:border-border aria-selected:bg-accent max-[560px]:gap-2 max-[560px]:px-2", element.props.className),
    children: <>
      {reader ? <Icon aria-hidden="true" size={18} className="mt-0.5" /> : <span className="grid size-8 flex-none place-items-center text-muted-foreground"><Icon aria-hidden="true" size={18} /></span>}
      <span className={reader ? "grid min-w-0 gap-1" : "grid min-w-0 flex-1 gap-0.5"}>
        <strong className={reader ? "text-[length:var(--ob-prose-body-size)] font-[650] text-(--ob-reader-text)" : "text-sm font-medium wrap-anywhere"}>{title}</strong>
        <Path className={secondary}>{path}</Path>
        {excerpt != null ? <span className={reader ? secondary : cn("line-clamp-2 text-xs leading-[18px] wrap-anywhere", workspaceSecondary)}>{excerpt}</span> : null}
      </span>
      {metadata != null ? <span className={cn("flex-none pt-0.5 text-xs leading-[18px] max-[560px]:max-w-[4.5em]", workspaceSecondary)}>{metadata}</span> : null}
    </>,
  });
}

export function CommandMessage({ kind, title, description, detail }: { kind: "prompt" | "empty"; title?: string; description: ReactNode; detail?: string }) {
  const reader = useContext(CommandPresentation) === "reader";
  if (!reader) return <p className="m-0 px-4 py-8 text-center text-sm text-muted-foreground">{description}</p>;
  return <div className={cn(kind === "prompt" ? "site-reader-search-hint" : "site-reader-search-empty", "grid min-h-[210px] content-center justify-items-center gap-2 text-center text-(--ob-reader-muted)")}>
    <Search aria-hidden="true" size={kind === "prompt" ? 20 : 22} />
    {title ? <strong className="text-[length:var(--ob-prose-body-size)] text-(--ob-reader-text)">{title}</strong> : null}
    <p className="m-0 text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted)">{description}</p>
    {detail ? <span className="text-[length:var(--ob-prose-caption-size)]">{detail}</span> : null}
  </div>;
}

export function CommandFooter({ children }: { children?: ReactNode }) {
  const reader = useContext(CommandPresentation) === "reader";
  return <footer className={reader
    ? "flex h-9 items-center gap-[18px] border-t border-(--ob-reader-border) bg-(--ob-reader-surface-soft) px-[13px] text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted-on-soft) [&_kbd]:mr-[3px] [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-(--ob-reader-border) [&_kbd]:bg-(--ob-reader-surface) [&_kbd]:px-1 [&_kbd]:py-px [&_kbd]:[font:inherit] [&_kbd]:text-(--ob-reader-muted)"
    : "flex min-h-10 flex-none items-center gap-4 border-t border-border px-4 py-1 text-xs leading-[18px] text-muted-foreground max-[560px]:flex-wrap max-[560px]:gap-x-2 max-[560px]:gap-y-0"}>
    {children ?? <><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></>}
  </footer>;
}
