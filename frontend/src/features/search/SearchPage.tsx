import { releaseFeatures } from "../../shared/release-features";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { Select } from "@orbis/ui/select";

import { Input } from "@orbis/ui/input";
import { BookOpen, FileText, Folder, Globe, Paperclip } from "../../shared/ui/icons";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { GLOBAL_SEARCH_INPUT_ID } from "../workspace/use-workspace-search";
import { searchWorkspace, type SearchFilters } from "./api";
import { readSearchFilters, resultHref, SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH, SEARCH_STATUS_OPTIONS, SEARCH_TYPE_LABELS, SEARCH_TYPE_OPTIONS, writeSearchFilters } from "./search-state";

const resultIcons = { document: FileText, notebook: BookOpen, group: Folder, site: Globe, file: Paperclip };

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const filters = readSearchFilters(params);
  const [input, setInput] = useState(filters.q);
  const [composing, setComposing] = useState(false);
  const inputDirty = useRef(false);
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
  }, [input, composing, filters.q, filters.type, filters.status, setParams]);

  const results = useQuery({
    queryKey: ["global-search", sessionKey, filters],
    enabled: !pendingInput && Boolean(filters.q.trim()),
    queryFn: ({ signal }) => searchWorkspace(filters, auth, signal),
    retry: false,
  });

  function updateFilters(patch: Partial<SearchFilters>) {
    inputDirty.current = false;
    setParams(writeSearchFilters({ ...filters, q: input, ...patch, page: patch.page ?? 1 }));
  }
  const data = results.data && { ...results.data, items: results.data.items.filter(item => releaseFeatures.sites || item.type !== "site") };
  const loading = Boolean(filters.q.trim() && (pendingInput || results.isPending));
  const error = results.error;

  return <WorkspaceShell><PageContainer title="全局搜索" description="搜索有权访问的文档、评论、笔记本、分组与文件。">
    <form className="grid gap-4 mb-6" role="search" aria-label="内容搜索" onSubmit={(event) => { event.preventDefault(); if (!composing) updateFilters({ q: input }); }}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 flex-[1_1_16rem] gap-1.5 text-sm font-medium text-ob-foreground">搜索内容<Input id={GLOBAL_SEARCH_INPUT_ID} type="search" autoFocus maxLength={SEARCH_MAX_LENGTH} placeholder="搜索标题、正文、评论或文件名…" value={input} onChange={(event) => { inputDirty.current = true; setInput(event.target.value); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={(event) => { inputDirty.current = true; setInput(event.currentTarget.value); setComposing(false); }} /></label>
        <Button type="submit" variant="primary">搜索</Button>
        {input ? <Button variant="ghost" onClick={() => { setInput(""); setComposing(false); updateFilters({ q: "" }); }}>清空搜索</Button> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Select<SearchFilters["type"]> label="内容类型" value={filters.type} options={SEARCH_TYPE_OPTIONS} onValueChange={type => { if (type !== null) updateFilters({ type }); }} />
        <Select<SearchFilters["status"]> label="内容状态" value={filters.status} options={SEARCH_STATUS_OPTIONS} onValueChange={status => { if (status !== null) updateFilters({ status }); }} />
      </div>
      <p className="text-xs leading-[18px] text-ob-muted-foreground">文件与附件支持名称和已有元数据检索。</p>
    </form>

    {!filters.q.trim() && !pendingInput ? <p className="py-6 text-sm text-ob-muted-foreground">输入关键词，查找文档、评论或文件。</p> : null}
    {loading ? <LoadingState label="正在搜索…" /> : null}
    {!loading && !pendingInput && !error && filters.q.trim() && data ? <>
      <p className="text-sm" role="status">找到 {data.pagination.total} 条结果</p>
      {!data.items.length ? <p className="py-6 text-sm text-ob-muted-foreground">没有匹配的内容。试试其他关键词。</p> : <ul className="my-4 list-none p-0">
        {data.items.map(result => {
          const Icon = resultIcons[result.type];
          return <li key={`${result.type}:${result.id}`}><Link className="flex gap-3 rounded-ob-lg border-b border-ob-border p-4 text-ob-foreground hover:bg-ob-accent ob-focus-ring" to={resultHref(result)}>
            <Icon aria-hidden="true" className="mt-0.5 flex-none" size={20} />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-3"><h2 className="m-0 text-base font-semibold wrap-anywhere">{result.title || "未命名内容"}</h2><span className="text-xs leading-[18px] text-ob-muted-foreground">{SEARCH_TYPE_LABELS[result.type]}{result.status === "archived" ? " · 已归档" : ""}</span></div>
              <p className="my-1 text-xs leading-[18px] text-ob-muted-foreground wrap-anywhere">{result.location}</p>
              <p className="mt-2 text-sm wrap-anywhere">{result.match === "comment" ? "评论：" : ""}{result.snippet || "无摘要"}</p>
            </div>
          </Link></li>;
        })}
      </ul>}
      {data.pagination.total_pages > 1 ? <nav className="flex flex-wrap items-center justify-center gap-4 text-sm" aria-label="搜索结果分页">
        <Button disabled={!data.pagination.has_previous || results.isFetching} onClick={() => updateFilters({ page: filters.page - 1 })}>上一页</Button>
        <span>第 {data.pagination.page} / {data.pagination.total_pages} 页</span>
        <Button disabled={!data.pagination.has_next || results.isFetching} onClick={() => updateFilters({ page: filters.page + 1 })}>下一页</Button>
      </nav> : null}
    </> : null}
  </PageContainer></WorkspaceShell>;
}
