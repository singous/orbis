import { DialogPopup, DialogTitle, type DialogPopupProps } from "@orbis/ui/dialog";
import { Input, type InputProps } from "@orbis/ui/input";
import { cloneElement, createContext, useContext, type ComponentProps, type ComponentType, type ReactElement, type ReactNode } from "react";
import { cn } from "../cn";
import { FileText, Search } from "../icons";

type CommandPreset = "workspace" | "reader";
const CommandPresentation = createContext<CommandPreset>("workspace");
const readerFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ob-reader-accent)";

type CommandPopupProps = Omit<DialogPopupProps, "className" | "backdropClassName" | "viewportClassName"> & { preset: CommandPreset; title: string };

/** 搜索的布局与命名属于展示层；Dialog 的会话、退出和焦点恢复仍由调用方管理。 */
export function CommandPopup({ preset, title, children, ...props }: CommandPopupProps) {
  const reader = preset === "reader";
  return <CommandPresentation value={preset}><DialogPopup {...props}
    backdropClassName={reader ? "site-reader-search-backdrop bg-(--ob-reader-search-scrim) motion-reduce:transition-none" : "search-palette-backdrop"}
    viewportClassName={reader ? "site-reader-search-viewport items-start justify-items-center px-5 pt-[min(12vh,110px)] pb-[30px] [@media(max-width:800px)]:p-3" : "p-0"}
    className={reader
      ? "site-reader-search-dialog block w-[min(660px,100%)] max-w-none overflow-hidden border-(--ob-reader-border) bg-(--ob-reader-surface) p-0 font-ob-sans text-(--ob-reader-text) motion-reduce:transition-none"
      : "search-palette flex h-[min(480px,calc(100dvh-48px))] min-h-0 w-[min(720px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[18px] bg-ob-popover p-0 max-[560px]:h-[min(560px,calc(100dvh-24px))] max-[560px]:max-h-[calc(100dvh-24px)] max-[560px]:w-[calc(100vw-24px)]"}>
    <DialogTitle className="sr-only">{title}</DialogTitle>
    {children}
  </DialogPopup></CommandPresentation>;
}

type CommandInputProps = Omit<InputProps, "className" | "role" | "aria-controls" | "aria-activedescendant" | "aria-expanded" | "children"> & { listId: string; activeId?: string; children?: ReactNode };
export function CommandInput({ listId, activeId, children, ...props }: CommandInputProps) {
  const reader = useContext(CommandPresentation) === "reader";
  return <div className={reader ? "site-reader-search-field relative h-[57px] border-b border-(--ob-reader-border) bg-(--ob-reader-surface)" : "flex min-h-16 flex-none items-center gap-3 border-b border-ob-border px-4 py-3 text-ob-muted-foreground"}>
    <Search aria-hidden="true" size={reader ? 18 : 20} className={reader ? "pointer-events-none absolute inset-y-0 start-3 my-auto text-(--ob-reader-muted)" : "flex-none"} />
    <Input {...props} role="combobox" aria-controls={listId} aria-expanded="true" aria-activedescendant={activeId} className={reader
      ? `h-full min-h-0 rounded-none border-0 bg-transparent ps-[42px] pe-[54px] text-(--ob-reader-text) shadow-none ${readerFocus}`
      : "h-9 min-h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-base font-normal text-ob-foreground shadow-none [&::-webkit-search-cancel-button]:hidden"} />
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
  const workspaceSecondary = selected ? "text-ob-item-foreground" : "text-ob-muted-foreground";
  const secondary = reader ? "truncate text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) group-aria-selected/search-result:text-(--ob-reader-muted-on-soft)" : cn("truncate text-xs leading-[18px]", workspaceSecondary);
  // 仅补展示属性和内容，保留 Link/Button 本身及调用方的事件、ref、tabIndex 和可访问名称。
  return cloneElement(element, {
    role: "option",
    "aria-selected": selected,
    className: cn(reader
      ? `group/search-result grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2.5 rounded-[9px] border-0 border-current bg-transparent px-3 py-[11px] text-left text-(--ob-reader-muted) aria-selected:bg-(--ob-reader-accent-soft) aria-selected:text-(--ob-reader-accent) ${selected ? "is-active" : ""} ${readerFocus}`
      : "flex w-full min-w-0 items-start gap-3 rounded-[9px] border border-transparent bg-transparent p-3 text-start text-ob-foreground hover:bg-ob-accent aria-selected:border-ob-border aria-selected:bg-ob-accent max-[560px]:gap-2 max-[560px]:px-2", element.props.className),
    children: <>
      {reader ? <Icon aria-hidden="true" size={18} className="mt-0.5" /> : <span className="grid size-8 flex-none place-items-center text-ob-muted-foreground"><Icon aria-hidden="true" size={18} /></span>}
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
  if (!reader) return <p className="m-0 px-4 py-8 text-center text-sm text-ob-muted-foreground">{description}</p>;
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
    : "flex min-h-10 flex-none items-center gap-4 border-t border-ob-border px-4 py-1 text-xs leading-[18px] text-ob-muted-foreground max-[560px]:flex-wrap max-[560px]:gap-x-2 max-[560px]:gap-y-0"}>
    {children ?? <><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></>}
  </footer>;
}
