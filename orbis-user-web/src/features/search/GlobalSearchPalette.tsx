import { Modal } from "@heroui/react/modal";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { SelectField } from "../../shared/ui/SelectField";
import { BookOpen, FileText, Folder, Globe, Paperclip, Search, X } from "../../shared/ui/icons";
import type { SearchFilters, SearchResult } from "./api";
import { resultHref, SEARCH_MAX_LENGTH, SEARCH_TYPE_LABELS } from "./search-state";
import { matchPaletteCategories, parsePaletteInput, SEARCH_PALETTE_CATEGORIES, type SearchPaletteCategory } from "./search-palette-model";
import { usePaletteSearch } from "./use-palette-search";
import "./search-palette.css";

const icons = { document: FileText, notebook: BookOpen, group: Folder, site: Globe, file: Paperclip };
const statusOptions = [{ value: "active", label: "当前内容" }, { value: "archived", label: "已归档" }, { value: "all", label: "包含归档" }];
const resultKey = (result: SearchResult) => `${result.type}:${result.workspace_id}:${result.id}`;
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

function initialInput(filters: Partial<SearchFilters>) {
  const category = SEARCH_PALETTE_CATEGORIES.find(item => item.type === filters.type);
  return category ? `${category.alias} ${filters.q ?? ""}` : filters.q ?? "";
}

export function GlobalSearchPalette({ initialFilters, onClose }: { initialFilters: Partial<SearchFilters>; onClose: () => void }) {
  const navigate = useNavigate();
  const workspace = useStore(authStore, state => state.workspace);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const [input, setInput] = useState(() => initialInput(initialFilters));
  const [range, setRange] = useState(initialFilters.range ?? "current");
  const [status, setStatus] = useState<SearchFilters["status"]>(initialFilters.status ?? "active");
  const [page, setPage] = useState(initialFilters.page ?? 1);
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openingRequest = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const parsed = parsePaletteInput(input);
  const categories = matchPaletteCategories(input);
  const categoryMode = !input.trim() || (!parsed.hasPrefix && /^@\S*$/.test(input.trim()) && categories.length > 0);
  const filters: SearchFilters = { q: categoryMode ? "" : parsed.q, type: parsed.type, range, status, page };
  const { results, scopes, pendingInput } = usePaletteSearch(filters, { enabled: true, composing });
  const resultItems = !pendingInput && !results.isError && filters.q ? results.data?.items ?? [] : [];
  const options = categoryMode ? categories.map(item => item.type) : resultItems.map(resultKey);
  const selectedIndex = Math.max(0, selected ? options.indexOf(selected) : 0);
  const activeKey = options[selectedIndex];
  const activeId = activeKey ? `${listId}-${activeKey}` : undefined;
  const waiting = Boolean(filters.q && (pendingInput || results.isPending));
  const shortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";

  useEffect(() => { setSelected(null); setOpenError(null); }, [input, range, status, page]);
  useEffect(() => () => { openingRequest.current?.abort(); }, []);

  function close() {
    openingRequest.current?.abort();
    onClose();
  }

  function cancelOpening() {
    openingRequest.current?.abort();
    openingRequest.current = null;
    setOpening(false);
    setOpenError(null);
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
    setOpenError(null);
    const sourceSession = sessionKey;
    try {
      await preparePendingNavigation(controller.signal);
      if (controller.signal.aborted || getAuthSessionKey(authStore.getState()) !== sourceSession) return;
      const href = resultHref(result, workspace?.id);
      onClose();
      navigate(href);
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
        setOpenError(error instanceof Error ? error.message : "请关闭搜索，检查当前内容后重试。");
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

  const workspaces = scopes.data?.workspaces ?? results.data?.workspaces ?? [];
  const scopeOptions = [
    { value: "current", label: `当前空间 · ${workspace?.name ?? "工作空间"}` },
    { value: "all", label: "所有可访问空间" },
    ...workspaces.map(item => ({ value: item.id, label: item.name })),
  ];
  if (!scopeOptions.some(item => item.value === range)) scopeOptions.push({ value: range, label: "所选工作空间" });

  return <Modal.Backdrop className="orbis-modal-backdrop search-palette-backdrop" isOpen onOpenChange={open => { if (!open) close(); }}>
    <Modal.Container className="orbis-modal-container search-palette-container">
      <Modal.Dialog className="orbis-modal-dialog search-palette">
        <Modal.Heading className="sr-only">全局搜索</Modal.Heading>
        <div className="search-palette-input-row">
          <Search aria-hidden="true" size={20} />
          <input ref={inputRef} autoFocus type="search" role="combobox" aria-label="搜索任何内容" placeholder="搜索任何内容…" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={activeId} value={input} maxLength={SEARCH_MAX_LENGTH} onChange={event => changeInput(event.target.value)} onKeyDown={handleKey} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { changeInput(event.currentTarget.value); setComposing(false); }} />
          {input ? <ActionButton aria-label="清空搜索" className="search-palette-clear" onClick={() => { changeInput(""); inputRef.current?.focus(); }}><X size={16} /></ActionButton> : null}
          <kbd>{shortcut}</kbd>
        </div>
        <div className="search-palette-context">
          <SelectField aria-label="搜索范围" density="compact" value={range} options={scopeOptions} onChange={value => { cancelOpening(); setRange(value); setPage(1); }} />
          <SelectField aria-label="内容状态" density="compact" value={status} options={statusOptions} onChange={value => { cancelOpening(); setStatus(value as SearchFilters["status"]); setPage(1); }} />
          {parsed.category ? <ActionButton className="search-palette-type" aria-label="清除类型筛选" onClick={() => { changeInput(parsed.q); inputRef.current?.focus(); }}>{parsed.category.label}<X size={12} /></ActionButton> : null}
        </div>
        <div className="search-palette-content">
          {scopes.isError ? <div className="search-palette-error" role="alert">工作空间列表未能加载。<ActionButton onClick={() => void scopes.refetch()}>重试</ActionButton></div> : null}
          {openError ? <div className="search-palette-error" role="alert">{openError}</div> : null}
          {categoryMode ? <p className="search-palette-heading">选择搜索内容</p> : null}
          {!categoryMode && !filters.q ? <p className="search-palette-empty">输入关键词，搜索{parsed.category?.label ?? "全部内容"}。</p> : null}
          {waiting ? <LoadingState label="正在搜索…" compact /> : null}
          {!pendingInput && filters.q && results.isError ? <div className="search-palette-error" role="alert">{results.error instanceof Error ? results.error.message : "搜索失败，请重试。"}<ActionButton onClick={() => void results.refetch()}>重试搜索</ActionButton></div> : null}
          {!waiting && filters.q && !results.isError && results.data ? <p className="search-palette-heading" role="status">找到 {results.data.pagination.total} 条结果</p> : null}
          {!waiting && filters.q && !results.isError && results.data && !resultItems.length ? <p className="search-palette-empty">没有匹配的内容。试试其他关键词或范围。</p> : null}
          <div ref={listRef} id={listId} role="listbox" aria-label={categoryMode ? "搜索内容类型" : "搜索结果"} aria-busy={waiting || opening} className={categoryMode ? "search-palette-categories" : "search-palette-results"}>
            {categoryMode ? categories.map(category => {
              const Icon = icons[category.type];
              return <button key={category.type} id={`${listId}-${category.type}`} role="option" aria-selected={activeKey === category.type} tabIndex={-1} type="button" className="search-palette-category" onMouseMove={() => setSelected(category.type)} onClick={() => chooseCategory(category)}>
                <span className="search-palette-category-icon"><Icon aria-hidden="true" size={20} /></span>
                <span><strong>{category.alias}</strong><span>{category.description}</span></span>
              </button>;
            }) : resultItems.map(result => {
              const Icon = icons[result.type];
              const key = resultKey(result);
              const crossWorkspace = result.workspace_id !== workspace?.id;
              const children = <><span className="search-palette-result-icon"><Icon aria-hidden="true" size={18} /></span><span className="search-palette-result-copy"><strong>{result.title || "未命名内容"}</strong><span>{result.workspace_name} · {result.location}</span>{result.snippet ? <span className="search-palette-snippet">{result.match === "comment" ? "评论：" : ""}{result.snippet}</span> : null}{crossWorkspace ? <span>切换工作空间后打开</span> : null}</span><span className="search-palette-result-type">{SEARCH_TYPE_LABELS[result.type]}{result.status === "archived" ? " · 归档" : ""}</span></>;
              const props = { id: `${listId}-${key}`, role: "option", "aria-selected": activeKey === key, "aria-disabled": opening || undefined, "data-search-result": true, tabIndex: -1, className: "search-palette-result", onMouseMove: () => setSelected(key) };
              return crossWorkspace
                ? <button key={key} {...props} type="button" onClick={() => void openResult(result)}>{children}</button>
                : <Link key={key} {...props} to={resultHref(result, workspace?.id)} onClick={event => { if (plainClick(event)) { event.preventDefault(); void openResult(result); } }}>{children}</Link>;
            })}
          </div>
          {!waiting && !results.isError && filters.q && results.data && results.data.pagination.total_pages > 1 ? <div className="search-palette-pagination" aria-label="搜索结果分页">
            <Button size="sm" disabled={!results.data.pagination.has_previous || opening} onClick={() => setPage(current => current - 1)}>上一页</Button>
            <span>第 {results.data.pagination.page} / {results.data.pagination.total_pages} 页</span>
            <Button size="sm" disabled={!results.data.pagination.has_next || opening} onClick={() => setPage(current => current + 1)}>下一页</Button>
          </div> : null}
        </div>
        <footer className="search-palette-footer">
          <span>↑ ↓ 选择</span>
          <ActionButton aria-label="关闭搜索" className="search-palette-dismiss" onClick={close}>Esc 关闭</ActionButton>
          <span className="search-palette-execute" role={opening ? "status" : undefined}>{opening ? "正在准备打开…" : categoryMode ? "选择 Enter" : "打开 Enter"}</span>
        </footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
