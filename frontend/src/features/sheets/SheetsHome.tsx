import "./palette.css";
import { reportError } from "../../shared/api/request-feedback";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@orbis/ui/dialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Plus, Table2 } from "../../shared/ui/icons";
import { PageContainer } from "../../shared/ui/PageContainer";
import { Select } from "@orbis/ui/select";

import { Input } from "@orbis/ui/input";
import { DocumentShell } from "../documents/DocumentShell";
import { useNotebooks } from "../documents/queries";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { sheetAPI } from "./api";

const templates = [
  { id: "", name: "空白数据表", description: "自由定义字段" },
  { id: "tasks", name: "任务跟踪", description: "任务、状态与日期" },
  { id: "books", name: "阅读清单", description: "书目、进度与评分" },
  { id: "plan", name: "目标计划", description: "目标、状态与安排" },
  { id: "contacts", name: "联系人", description: "姓名、电话与邮箱" },
];
export function SheetsHome() {
  const auth = useAuthRequest(),
    api = useMemo(() => sheetAPI(auth), [auth]),
    client = useQueryClient(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [collection, setCollection] = useState(params.get("collection") ?? ""),
    [target, setTarget] = useState(collection),
    [creating, setCreating] = useState(false),
    [template, setTemplate] = useState(""),
    [title, setTitle] = useState("未命名数据表"),
    [busy, setBusy] = useState(false);
  const intent = useRef<{
    id: string;
    collection_id: string;
    title: string;
    template: string;
  } | null>(null);
  const notebooks = useNotebooks(),
    canEdit = canMutateWorkspaceContent(
      useStore(authStore, (s) => s.workspace),
    );
  const list = useInfiniteQuery({
    queryKey: ["sheet-directory", auth.workspaceId, collection],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => api.list(collection, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor || undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const notebookOptions =
    notebooks.data?.items.map((n) => ({ value: n.id, label: n.title })) ?? [];
  useEffect(() => {
    if (!target && notebookOptions[0]) setTarget(notebookOptions[0].value);
  }, [notebooks.data, target]);
  function openCreate() {
    if (collection) setTarget(collection);
    setCreating(true);
  }
  async function create() {
    if (!target || !title.trim()) {
      reportError("请填写名称并选择所属笔记本");
      return;
    }
    setBusy(true);
    intent.current ??= {
      id: newUUID(),
      collection_id: target,
      title,
      template,
    };
    try {
      const sheet = await api.create(intent.current);
      intent.current = null;
      await client.invalidateQueries({
        queryKey: ["sheet-directory", auth.workspaceId],
      });
      await client.invalidateQueries({
        queryKey: ["sheet-embed-list", auth.workspaceId],
      });
      await client.invalidateQueries({
        queryKey: ["note-tree", sheet.collection_id],
      });
      navigate(`/documents/${sheet.document_id}`);
    } catch (e) { reportError(e);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))
        intent.current = null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <DocumentShell notebookId={collection || undefined}>
      <PageContainer
        title="数据表"
        description="组织结构化信息，在表格与看板之间协作。"
        actions={
          canEdit ? (
            <Button
              variant="primary"
              onClick={openCreate}
            >
              <Plus size={16} aria-hidden="true" />新建数据表
            </Button>
          ) : undefined
        }
      >
        <div className="sheet-data-theme text-sm text-ob-foreground">
          <div className="mb-6 w-[220px]">
            <Select
              aria-label="筛选笔记本"
              density="compact"
              value={collection}
              options={[{ value: "", label: "全部笔记本" }, ...notebookOptions]}
              onValueChange={next => { if (next !== null) setCollection(next); }}
            />
          </div>
          {list.error ? (
            null
          ) : items.length ? (
            <div className="sheet-home-list rounded-[12px] border border-ob-surface-edge bg-ob-card px-5 [box-shadow:var(--ob-shadow-card)] empty:hidden">
              {items.map((item) => (
                <Link className="flex items-center gap-3 border-b border-b-ob-border py-[18px] in-[.workspace-shell]:border-b-ob-workspace-outline text-ob-foreground no-underline last:border-b-0 last:border-b-current" key={item.id} to={`/documents/${item.document_id}`}>
                  <Table2 size={18} />
                  <span>{item.title}</span>
                  <small className="ml-auto text-[12px] text-(--ob-page-muted-foreground)">
                    {new Date(item.updated_at_ms).toLocaleDateString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </small>
                </Link>
              ))}
            </div>
          ) : !list.isLoading ? (
            <EmptyState
              icon={<Table2 size={24} />}
              title="还没有数据表"
              description="从一张空白表开始，或选择模板整理任务、资料与联系人。"
              action={
                canEdit ? (
                  <Button variant="secondary" onClick={openCreate}>
                    新建数据表
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <p className="text-[12px] text-(--ob-page-muted-foreground)">正在读取…</p>
          )}
          {list.hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button
                size="sm"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                加载更多
              </Button>
            </div>
          )}
        </div>
        <Dialog
          open={creating}
          dismissible={!busy}
          onOpenChange={(open) => {
            if (!busy) setCreating(open);
          }}
        >
          <DialogContent
            title="新建数据表"
            description="选择所属笔记本和起始模板。"
            className="max-w-140"
          >
            <div className="grid gap-5 pt-6">
              <label className="grid gap-1.5 text-sm font-medium text-ob-foreground">数据表名称<Input
                aria-label="数据表名称"
                value={title}
                disabled={busy || !!intent.current}
                onChange={(e) => setTitle(e.target.value)}
              /></label>
              <Select
                label="所属笔记本"
                value={target}
                options={notebookOptions}
                disabled={busy || !!intent.current}
                onValueChange={next => { if (next !== null) setTarget(next); }}
              />
              {!notebookOptions.length && (
                <p className="text-[12px] text-(--ob-page-muted-foreground)">请先在文档中心创建笔记本。</p>
              )}
              <span className="text-sm font-medium text-ob-muted-foreground">起始模板</span>
              <div className="grid grid-cols-2 gap-2.5">
                {templates.map((t) => (
                  <Button variant="ghost"
                    key={t.id}
                    aria-pressed={template === t.id}
                    // 保持原模板卡片 76px 的最小高度，长文案仍可换行。
                    className={`min-h-[76px] justify-start whitespace-normal rounded-ob-xl border-ob-border px-4 py-3 text-start ${template === t.id ? "bg-ob-accent outline-1 outline-ob-ring" : "bg-ob-card"}`}
                    disabled={busy || !!intent.current}
                    onClick={() => setTemplate(t.id)}
                  >
                    <span className="grid gap-1"><strong className="text-sm font-medium">{t.name}</strong><span className="text-xs text-ob-muted-foreground">{t.description}</span></span>
                  </Button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button disabled={busy} onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!target || !title.trim()}
                onClick={() => void create()}
              >
                {intent.current ? "重试创建" : "创建数据表"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContainer>
    </DocumentShell>
  );
}
