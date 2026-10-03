import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { ApiError } from "../../shared/api/api-client";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { SelectField } from "../../shared/ui/SelectField";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { TextInput } from "../../shared/ui/TextInput";
import { BookOpen, FileText, Folder, Globe, Paperclip } from "../../shared/ui/icons";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { GLOBAL_SEARCH_INPUT_ID } from "../workspace/use-workspace-search";
import { searchWorkspace, type SearchFilters } from "./api";
import { readSearchFilters, resultHref, SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH, SEARCH_TYPE_LABELS, SEARCH_TYPE_OPTIONS, writeSearchFilters } from "./search-state";
import "./search.css";

const resultIcons = { document: FileText, notebook: BookOpen, group: Folder, site: Globe, file: Paperclip };
const statusOptions = [{ value: "active", label: "当前内容" }, { value: "archived", label: "已归档" }, { value: "all", label: "包含归档" }];

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const filters = readSearchFilters(params);
  const [input, setInput] = useState(filters.q);
  const [composing, setComposing] = useState(false);
  const inputDirty = useRef(false);
  const workspace = useStore(authStore, state => state.workspace);
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const auth = useAuthRequest();
  const queryClient = useQueryClient();
  const pendingInput = composing || input.trim() !== filters.q.trim();
  useEffect(() => { if (pendingInput) void queryClient.cancelQueries({ queryKey: ["global-search", sessionKey] }); }, [pendingInput, queryClient, sessionKey]);

  useEffect(() => { setInput(filters.q); inputDirty.current = false; }, [filters.q]);
  useEffect(() => {
    if (composing || !inputDirty.current) return;
    const timer = window.setTimeout(() => {
      inputDirty.current = false;
      setParams(writeSearchFilters({ ...filters, q: input, page: 1 }), { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input, composing, filters.q, filters.range, filters.type, filters.status, setParams]);

  const results = useQuery({
    queryKey: ["global-search", sessionKey, filters],
    enabled: !pendingInput && Boolean(filters.q.trim()),
    queryFn: ({ signal }) => searchWorkspace(filters, auth, signal),
    retry: false,
  });
  // Scope discovery uses no content query and remains available during typing/errors.
  const scopes = useQuery({
    queryKey: ["global-search-scopes", sessionKey],
    queryFn: ({ signal }) => searchWorkspace({ q: "", range: "current", type: "all", status: "active", page: 1 }, auth, signal),
    staleTime: 60_000,
    retry: false,
  });

  function updateFilters(patch: Partial<SearchFilters>) {
    inputDirty.current = false;
    setParams(writeSearchFilters({ ...filters, q: input, ...patch, page: patch.page ?? 1 }));
  }
  const data = results.data;
  const workspaces = scopes.data?.workspaces ?? data?.workspaces ?? [];
  const scopeOptions = [
    { value: "current", label: `当前空间 · ${workspace?.name ?? "工作空间"}` },
    { value: "all", label: "所有可访问空间" },
    ...workspaces.map(item => ({ value: item.id, label: item.name })),
  ];
  if (!scopeOptions.some(item => item.value === filters.range)) scopeOptions.push({ value: filters.range, label: "所选工作空间" });
  const loading = Boolean(filters.q.trim() && (pendingInput || results.isPending));
  const error = results.error;

  return <WorkspaceShell><PageContainer title="全局搜索" description="搜索有权访问的文档、评论、笔记本、分组、站点与文件。">
    <form className="global-search-form" role="search" aria-label="内容搜索" onSubmit={(event) => { event.preventDefault(); if (!composing) updateFilters({ q: input }); }}>
      <div className="global-search-input-row">
        <TextInput id={GLOBAL_SEARCH_INPUT_ID} label="搜索内容" aria-label="搜索内容" type="search" autoFocus maxLength={SEARCH_MAX_LENGTH} placeholder="搜索标题、正文、评论或文件名…" value={input} onChange={(event) => { inputDirty.current = true; setInput(event.target.value); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={(event) => { inputDirty.current = true; setInput(event.currentTarget.value); setComposing(false); }} />
        <Button type="submit" variant="primary">搜索</Button>
        {input ? <Button variant="ghost" onClick={() => { setInput(""); setComposing(false); updateFilters({ q: "" }); }}>清空搜索</Button> : null}
      </div>
      <div className="global-search-filters">
        <SelectField label="搜索范围" value={filters.range} options={scopeOptions} onChange={(range) => updateFilters({ range })} />
        <SelectField label="内容类型" value={filters.type} options={SEARCH_TYPE_OPTIONS} onChange={(type) => updateFilters({ type: type as SearchFilters["type"] })} />
        <SelectField label="内容状态" value={filters.status} options={statusOptions} onChange={(status) => updateFilters({ status: status as SearchFilters["status"] })} />
      </div>
      <p className="global-search-help">搜索范围不会切换当前工作空间。打开其他空间的结果时才切换；文件仅搜索名称与已有元数据。</p>
    </form>
    {scopes.isError ? <StatusMessage tone="error" title="工作空间列表加载失败"><Button onClick={() => void scopes.refetch()}>重新加载范围</Button></StatusMessage> : null}
    {error && !pendingInput ? <StatusMessage tone="error" title={error instanceof ApiError && error.status === 403 ? "无权搜索该范围" : "搜索失败"}>{error instanceof Error ? error.message : "请稍后重试。"}<Button onClick={() => void results.refetch()}>重试</Button></StatusMessage> : null}
    {!filters.q.trim() && !pendingInput ? <p className="global-search-empty">输入关键词，搜索所选范围内的内容。</p> : null}
    {loading ? <LoadingState label="正在搜索…" /> : null}
    {!loading && !pendingInput && !error && filters.q.trim() && data ? <>
      <p className="global-search-summary" role="status">找到 {data.pagination.total} 条结果</p>
      {!data.items.length ? <p className="global-search-empty">没有匹配的内容。试试其他关键词或调整范围。</p> : <ul className="global-search-results">
        {data.items.map(result => {
          const Icon = resultIcons[result.type];
          return <li key={`${result.type}:${result.id}`}><Link className="global-search-result" to={resultHref(result, workspace?.id)}>
            <Icon aria-hidden="true" size={20} />
            <div className="global-search-result-copy"><div className="global-search-result-heading"><h2>{result.title || "未命名内容"}</h2><span>{SEARCH_TYPE_LABELS[result.type]}{result.status === "archived" ? " · 已归档" : ""}</span></div>
              <p className="global-search-result-location">{result.workspace_name} · {result.location}</p>
              <p className="global-search-result-snippet">{result.match === "comment" ? "评论：" : ""}{result.snippet || "无摘要"}</p>
            </div>
          </Link></li>;
        })}
      </ul>}
      {data.pagination.total_pages > 1 ? <nav className="global-search-pagination" aria-label="搜索结果分页">
        <Button disabled={!data.pagination.has_previous || results.isFetching} onClick={() => updateFilters({ page: filters.page - 1 })}>上一页</Button>
        <span>第 {data.pagination.page} / {data.pagination.total_pages} 页</span>
        <Button disabled={!data.pagination.has_next || results.isFetching} onClick={() => updateFilters({ page: filters.page + 1 })}>下一页</Button>
      </nav> : null}
    </> : null}
  </PageContainer></WorkspaceShell>;
}
