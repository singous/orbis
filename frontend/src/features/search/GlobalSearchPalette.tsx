import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { Dialog, DialogClose } from "@orbis/ui/dialog";
import { CommandPopup, CommandInput, CommandList, CommandResult, CommandMessage, CommandFooter } from "../../shared/ui/command";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";
import { Button } from "@orbis/ui/button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Select } from "@orbis/ui/select";
import { BookOpen, FileText, Folder, Globe, Paperclip, X } from "../../shared/ui/icons";
import type { SearchFilters, SearchResult } from "./api";
import { resultHref, SEARCH_MAX_LENGTH, SEARCH_STATUS_OPTIONS, SEARCH_TYPE_LABELS } from "./search-state";
import { matchPaletteCategories, parsePaletteInput, SEARCH_PALETTE_CATEGORIES, type SearchPaletteCategory } from "./search-palette-model";
import { usePaletteSearch } from "./use-palette-search";

const icons = { document: FileText, notebook: BookOpen, group: Folder, site: Globe, file: Paperclip };
const resultKey = (result: SearchResult) => `${result.type}:${result.workspace_id}:${result.id}`;
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

function initialInput(filters: Partial<SearchFilters>) {
  const category = SEARCH_PALETTE_CATEGORIES.find(item => item.type === filters.type);
  return category ? `${category.alias} ${filters.q ?? ""}` : filters.q ?? "";
}

export function GlobalSearchPalette({ initialFilters, onClose, isOpen = true, onExited = () => {} }: { initialFilters: Partial<SearchFilters>; onClose: () => void; isOpen?: boolean; onExited?: () => void }) {
  const navigate = useNavigate();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const [input, setInput] = useState(() => initialInput(initialFilters));
  const [status, setStatus] = useState<SearchFilters["status"]>(initialFilters.status ?? "active");
  const [page, setPage] = useState(initialFilters.page ?? 1);
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const openingRequest = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const parsed = parsePaletteInput(input);
  const categories = matchPaletteCategories(input);
  const categoryMode = !input.trim() || (!parsed.hasPrefix && /^@\S*$/.test(input.trim()) && categories.length > 0);
  const filters: SearchFilters = { q: categoryMode ? "" : parsed.q, type: parsed.type, status, page };
  const { results, pendingInput } = usePaletteSearch(filters, { enabled: isOpen, composing });
  const resultItems = !pendingInput && !results.isError && filters.q ? results.data?.items.filter(item => releaseFeatures.sites || item.type !== "site") ?? [] : [];
  const options = categoryMode ? categories.map(item => item.type) : resultItems.map(resultKey);
  const selectedIndex = Math.max(0, selected ? options.indexOf(selected) : 0);
  const activeKey = options[selectedIndex];
  const activeId = activeKey ? `${listId}-${activeKey}` : undefined;
  const waiting = Boolean(filters.q && (pendingInput || results.isPending));
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";

  useEffect(() => { setSelected(null);  }, [input, status, page]);
  useEffect(() => () => { openingRequest.current?.abort(); }, []);
  useLayoutEffect(() => { if (!isOpen) openingRequest.current?.abort(); }, [isOpen]);

  function close() {
    openingRequest.current?.abort();
    onClose();
  }

  function cancelOpening() {
    openingRequest.current?.abort();
    openingRequest.current = null;
    setOpening(false);

  }

  function changeInput(value: string) {
    cancelOpening();
    setInput(value);
    setPage(1);
  }

  function chooseCategory(category: SearchPaletteCategory) {
    changeInput(`${category.alias} `);
    inputRef.current?.focus();
  }

  async function openResult(result: SearchResult) {
    if (openingRequest.current) return;
    const controller = new AbortController();
    openingRequest.current = controller;
    setOpening(true);

    const sourceSession = sessionKey;
    try {
      await preparePendingNavigation(controller.signal);
      if (controller.signal.aborted || getAuthSessionKey(authStore.getState()) !== sourceSession) return;
      const href = resultHref(result);
      onClose();
      navigate(href);
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        reportError(error);
      }
    } finally {
      if (openingRequest.current === controller) openingRequest.current = null;
      if (!controller.signal.aborted) setOpening(false);
    }
  }

  function activate() {
    if (!activeKey || opening || pendingInput || composing) return;
    if (categoryMode) chooseCategory(categories[selectedIndex]);
    else if (resultItems[selectedIndex]) void openResult(resultItems[selectedIndex]);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing || event.keyCode === 229) {
      // Let the input method consume Escape without dismissing the palette.
      if (event.key === "Escape") event.stopPropagation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (event.key === "Enter") { event.preventDefault(); activate(); return; }
    if (!options.length || opening) return;
    let next = selectedIndex;
    if (event.key === "ArrowDown") next = (selectedIndex + 1) % options.length;
    else if (event.key === "ArrowUp") next = (selectedIndex - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    setSelected(options[next]);
    listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.scrollIntoView?.({ block: "nearest" });
  }

  return <Dialog open={isOpen} onOpenChange={open => { if (!open) close(); }} onOpenChangeComplete={open => { if (!open) onExited(); }}>
    <CommandPopup preset="workspace" title="全局搜索" initialFocus={inputRef} inert={!isOpen ? true : undefined}>
      <CommandInput ref={inputRef} type="search" aria-label="搜索任何内容" placeholder="搜索任何内容…" aria-autocomplete="list" listId={listId} activeId={activeId} value={input} maxLength={SEARCH_MAX_LENGTH} onChange={event => changeInput(event.target.value)} onKeyDown={handleKey} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { changeInput(event.currentTarget.value); setComposing(false); }}>
        {input ? <Button appearance="unstyled" aria-label="清空搜索" className="size-4 min-h-0 flex-none border-0 p-0 pointer-coarse:size-11" onClick={() => { changeInput(""); inputRef.current?.focus(); }}><X size={16} /></Button> : null}
        <kbd className="flex-none rounded-[5px] bg-ob-accent px-[5px] py-0.5 font-sans text-xs text-ob-foreground whitespace-nowrap max-[560px]:hidden">{shortcut}</kbd>
      </CommandInput>
      <div className="flex flex-none flex-wrap items-center gap-2 px-4 pt-3 max-[560px]:gap-1">
        <Select<SearchFilters["status"]> aria-label="内容状态" density="compact" wrapperClassName="w-auto min-w-0 max-w-full" className="border-transparent bg-transparent px-2 text-xs font-normal text-ob-muted-foreground shadow-none hover:bg-ob-accent hover:text-ob-foreground focus-visible:text-ob-foreground" value={status} options={SEARCH_STATUS_OPTIONS} onValueChange={value => { if (value !== null) { cancelOpening(); setStatus(value); setPage(1); } }} />
        {parsed.category ? <Button appearance="unstyled" className="inline-flex items-center min-h-0 gap-1 border-0 p-0 text-xs font-normal text-ob-muted-foreground pointer-coarse:min-h-11" aria-label={`清除类型筛选：${parsed.category.label}`} onClick={() => { changeInput(parsed.q); inputRef.current?.focus(); }}>{parsed.category.label}<X size={12} /></Button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
        {categoryMode ? <p className="mb-3 text-xs leading-[18px] font-semibold text-ob-muted-foreground">选择搜索内容</p> : null}
        {!categoryMode && !filters.q ? <CommandMessage kind="prompt" description={<>输入关键词，搜索{parsed.category?.label ?? "全部内容"}。</>} /> : null}
        {waiting ? <LoadingState label="正在搜索…" compact /> : null}
        {!waiting && filters.q && !results.isError && results.data ? <p className="mb-3 text-xs leading-[18px] font-semibold text-ob-muted-foreground" role="status">找到 {results.data.pagination.total} 条结果</p> : null}
        {!waiting && filters.q && !results.isError && results.data && !resultItems.length ? <CommandMessage kind="empty" description="没有匹配的内容。试试其他关键词。" /> : null}
        <CommandList ref={listRef} id={listId} aria-label={categoryMode ? "搜索内容类型" : "搜索结果"} aria-busy={waiting || opening} layout={categoryMode ? "categories" : "results"}>
          {categoryMode ? categories.map(category => {
            const Icon = icons[category.type];
            return <Button appearance="unstyled" key={category.type} id={`${listId}-${category.type}`} role="option" aria-selected={activeKey === category.type} tabIndex={-1} type="button" className="group flex min-h-20 min-w-0 items-center gap-3 rounded-ob-xl border border-ob-border bg-ob-card p-3 text-start hover:bg-ob-accent aria-selected:border-ob-primary aria-selected:bg-ob-accent max-[560px]:min-h-18" onMouseMove={() => setSelected(category.type)} onClick={() => chooseCategory(category)}>
              <span className="grid size-10 flex-none place-items-center rounded-[10px] border border-ob-border bg-ob-card text-ob-muted-foreground group-aria-selected:text-ob-primary"><Icon aria-hidden="true" size={20} /></span>
              <span className="grid min-w-0 gap-1"><strong className="font-mono text-sm font-semibold wrap-anywhere">{category.alias}</strong><span className="text-xs leading-[18px] text-ob-muted-foreground group-hover:text-ob-foreground group-aria-selected:text-ob-foreground">{category.description}</span></span>
            </Button>;
          }) : resultItems.map(result => {
            const Icon = icons[result.type];
            const key = resultKey(result);
            return <CommandResult key={key} selected={activeKey === key} icon={Icon} title={result.title || "未命名内容"} path={result.location} excerpt={result.snippet ? <>{result.match === "comment" ? "评论：" : ""}{result.snippet}</> : undefined} metadata={<>{SEARCH_TYPE_LABELS[result.type]}{result.status === "archived" ? " · 归档" : ""}</>} element={<Link id={`${listId}-${key}`} aria-disabled={opening || undefined} data-search-result tabIndex={-1} onMouseMove={() => setSelected(key)} to={resultHref(result)} onClick={event => { if (plainClick(event)) { event.preventDefault(); void openResult(result); } }} />} />;
          })}
        </CommandList>
        {!waiting && !results.isError && filters.q && results.data && results.data.pagination.total_pages > 1 ? <div className="mt-4 flex items-center justify-center gap-3 text-xs text-ob-muted-foreground" aria-label="搜索结果分页">
          <Button size="sm" className="rounded-full" disabled={!results.data.pagination.has_previous || opening} onClick={() => setPage(current => current - 1)}>上一页</Button>
          <span>第 {results.data.pagination.page} / {results.data.pagination.total_pages} 页</span>
          <Button size="sm" className="rounded-full" disabled={!results.data.pagination.has_next || opening} onClick={() => setPage(current => current + 1)}>下一页</Button>
        </div> : null}
      </div>
      <CommandFooter>
        <span className="max-[560px]:hidden">↑ ↓ 选择</span>
        <span className="inline-flex items-center gap-1"><kbd aria-hidden="true" className="font-sans">Esc</kbd><DialogClose asChild><Button appearance="unstyled" aria-label="关闭搜索" className="h-auto min-h-8 flex-none rounded-ob-lg border-0 px-1 text-xs font-normal text-ob-muted-foreground hover:text-ob-foreground">关闭</Button></DialogClose></span>
        <span className="ms-auto" role={opening ? "status" : undefined}>{opening ? "正在准备打开…" : categoryMode ? "选择 Enter" : "打开 Enter"}</span>
      </CommandFooter>
    </CommandPopup>
  </Dialog>;
}
