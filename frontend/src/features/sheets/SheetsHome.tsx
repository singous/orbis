import { reportError } from "../../shared/api/request-feedback";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent, DialogFooter } from "../../shared/ui/Dialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Plus, Table2 } from "../../shared/ui/icons";
import { PageContainer } from "../../shared/ui/PageContainer";
import { SelectField } from "../../shared/ui/SelectField";

import { TextInput } from "../../shared/ui/TextInput";
import { DocumentShell } from "../documents/DocumentShell";
import { useNotebooks } from "../documents/queries";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { sheetAPI } from "./api";
import "./sheets.css";

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
              icon={<Plus size={16} />}
              onClick={openCreate}
            >
              新建数据表
            </Button>
          ) : undefined
        }
      >
        <div className="sheet-home-content">
          <div className="sheet-home-filters">
            <SelectField
              aria-label="筛选笔记本"
              density="compact"
              value={collection}
              options={[{ value: "", label: "全部笔记本" }, ...notebookOptions]}
              onChange={setCollection}
            />
          </div>
          {list.error ? (
            null
          ) : items.length ? (
            <div className="sheet-home-list">
              {items.map((item) => (
                <Link key={item.id} to={`/documents/${item.document_id}`}>
                  <Table2 size={18} />
                  <span>{item.title}</span>
                  <small>
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
            <p className="sheet-muted">正在读取…</p>
          )}
          {list.hasNextPage && (
            <div className="sheet-list-more">
              <Button
                size="sm"
                isPending={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                加载更多
              </Button>
            </div>
          )}
        </div>
        <Dialog
          open={creating}
          onOpenChange={(open) => {
            if (!busy) setCreating(open);
          }}
        >
          <DialogContent
            title="新建数据表"
            description="选择所属笔记本和起始模板。"
            className="sheet-create-dialog"
          >
            <div className="sheet-create-fields">
              <TextInput
                label="数据表名称"
                aria-label="数据表名称"
                value={title}
                disabled={busy || !!intent.current}
                onChange={(e) => setTitle(e.target.value)}
              />
              <SelectField
                label="所属笔记本"
                value={target}
                options={notebookOptions}
                disabled={busy || !!intent.current}
                onChange={setTarget}
              />
              {!notebookOptions.length && (
                <p className="sheet-muted">请先在文档中心创建笔记本。</p>
              )}
              <span className="sheet-section-label">起始模板</span>
              <div className="sheet-template-list">
                {templates.map((t) => (
                  <ActionButton
                    key={t.id}
                    aria-pressed={template === t.id}
                    className={template === t.id ? "selected" : ""}
                    disabled={busy || !!intent.current}
                    onClick={() => setTemplate(t.id)}
                  >
                    <strong>{t.name}</strong>
                    <span>{t.description}</span>
                  </ActionButton>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button disabled={busy} onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isPending={busy}
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
