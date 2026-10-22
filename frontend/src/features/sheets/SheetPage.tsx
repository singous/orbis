import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignVerticalSpaceAround,
  Archive,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  Columns3,
  Copy,
  FileInput,
  Filter,
  Group,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useStore } from "zustand";
import { apiRequest, workspacePath } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import {
  authRequestOptions,
  useAuthRequest,
} from "../../shared/auth/use-auth-request";
import { newUUID } from "../../shared/ids";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";
import { ActionButton } from "../../shared/ui/ActionButton";
import { TextInput } from "../../shared/ui/TextInput";
import { DocumentShell } from "../documents/DocumentShell";
import { createNotebookSidebar } from "../documents/NotebookSectionMenu";
import { getNotebook } from "../documents/api";
import { useArchiveNote, useNotebook } from "../documents/queries";
import { ShareButton } from "../sharing/ShareButton";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { CellValue } from "./Cell";
import { FieldSettings } from "./FieldSettings";
import { anchorAt, Popover, type Anchor } from "./Popover";
import { SheetBoard } from "./SheetBoard";
import { SheetForms } from "./SheetForms";
import { SheetGrid } from "./SheetGrid";
import { ViewSettings, type SettingsMode } from "./ViewSettings";
import { sheetAPI } from "./api";
import {
  COLORS,
  KINDS,
  newField,
  newView,
  type Field,
  type Form,
  type Row,
  type View,
} from "./model";
import "./sheets.css";
import { useSheet } from "./use-sheet";

type Menu = {
  anchor: Anchor;
  field?: Field;
  view?: View;
  kind: "field" | "view" | "add" | "color";
};
const DocumentComments = lazy(() =>
  import("../collaboration/DocumentCollaborationPanel").then((m) => ({
    default: m.DocumentComments,
  })),
);

export function SheetPage() {
  const { sheetId = "" } = useParams();
  const auth = useAuthRequest();
  const [params] = useSearchParams();
  const meta = useQuery({
    queryKey: ["sheets", auth.workspaceId, sheetId, "meta"],
    queryFn: ({ signal }) => sheetAPI(auth).get(sheetId, signal),
  });
  if (meta.data)
    return (
      <Navigate
        replace
        to={`/documents/${meta.data.document_id}${params.size ? `?${params}` : ""}`}
      />
    );
  return (
    <DocumentShell>
      <div className="sheet-empty">
        {meta.error?.message ?? "正在打开数据表…"}
      </div>
    </DocumentShell>
  );
}
export function SheetWorkspace({
  id,
  embedded = false,
  initialView = "",
  readOnly = false,
  onViewChange,
}: {
  id: string;
  embedded?: boolean;
  initialView?: string;
  readOnly?: boolean;
  onViewChange?: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams(),
    [localView, setLocalView] = useState(initialView),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const selectedView = embedded ? localView : (params.get("view") ?? "");
  const client = useQueryClient();
  const c = useSheet(id, selectedView, query),
    canEdit =
      !readOnly &&
      canMutateWorkspaceContent(useStore(authStore, (s) => s.workspace));
  const [menu, setMenu] = useState<Menu | null>(null),
    [fieldEdit, setFieldEdit] = useState<{
      field: Field;
      index?: number;
      anchor?: Anchor;
    } | null>(null),
    [settings, setSettings] = useState<{
      mode: SettingsMode;
      anchor: Anchor;
    } | null>(null);
  const [record, setRecord] = useState<Row | null>(null),
    [rename, setRename] = useState<View | null>(null),
    [titleEdit, setTitleEdit] = useState(false),
    [title, setTitle] = useState("");
  const members = useQuery({
    queryKey: ["sheet-members", c.auth.workspaceId],
    queryFn: ({ signal }) =>
      apiRequest(workspacePath(c.auth, "/members?page=1&page_size=100"), {
        ...authRequestOptions(c.auth),
        signal,
      }) as Promise<{
        items: Array<{
          user_id: string;
          display_name: string;
          user?: { id: string; display_name: string };
        }>;
      }>,
    staleTime: 60000,
  });
  const people = (members.data?.items ?? []).map((m) => ({
    id: m.user_id ?? m.user?.id,
    label: m.display_name ?? m.user?.display_name ?? "成员",
    color: "gray",
  }));
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [cellDirty, setCellDirty] = useState(false);
  const navigate = useNavigate(),
    archiveNote = useArchiveNote();
  const notebook = useNotebook(c.meta.data?.collection_id);
  const userID = useStore(authStore, (s) => s.user?.id ?? "");
  const sheet = c.meta.data,
    view = c.view;
  const fields = useMemo(
    () =>
      sheet?.definition.fields.map((f) =>
        ["person", "created_by", "updated_by"].includes(f.kind)
          ? { ...f, options: people }
          : f,
      ) ?? [],
    [sheet, members.data],
  );
  if (!sheet || !view)
    return (
      <DocumentShell>
        <div className="sheet-empty">
          {c.meta.error ? (
            <>
              <p role="alert">{c.meta.error.message}</p>
              <ActionButton size="sm" onClick={() => void c.meta.refetch()}>
                重试
              </ActionButton>
            </>
          ) : (
            "正在打开数据表…"
          )}
        </div>
      </DocumentShell>
    );
  const activeForm = c.forms.data?.find((f) => f.id === selectedView);
  const fail = (e: unknown) =>
    c.setError(e instanceof Error ? e.message : String(e));
  function choose(id: string) {
    void preparePendingNavigation()
      .then(() => {
        if (embedded) {
          setLocalView(id);
          if (sheet!.definition.views.some((view) => view.id === id))
            onViewChange?.(id);
        } else setParams({ view: id });
        setMenu(null);
      })
      .catch(fail);
  }
  async function saveView(next: View) {
    await preparePendingNavigation();
    return c.update({
      ...sheet!,
      definition: {
        ...sheet!.definition,
        views: sheet!.definition.views.map((v) =>
          v.id === next.id ? next : v,
        ),
      },
    });
  }
  async function saveField(next: Field, insertIndex?: number) {
    const exists = sheet!.definition.fields.some((f) => f.id === next.id);
    const nextFields = [...sheet!.definition.fields];
    if (exists)
      nextFields.splice(
        nextFields.findIndex((f) => f.id === next.id),
        1,
        next,
      );
    else
      nextFields.splice(
        insertIndex ?? fieldEdit?.index ?? nextFields.length,
        0,
        next,
      );
    const views = sheet!.definition.views.map((v) => {
      const ids = [...v.field_ids];
      if (!exists)
        ids.splice(insertIndex ?? fieldEdit?.index ?? ids.length, 0, next.id);
      return { ...v, field_ids: ids };
    });
    return c.update({ ...sheet!, definition: { fields: nextFields, views } });
  }
  async function addView(kind: "grid" | "kanban" | "form") {
    try {
      await preparePendingNavigation();
    } catch (error) {
      fail(error);
      return;
    }
    setMenu(null);
    if (kind === "form") {
      const form: Form = {
        id: newUUID(),
        sheet_id: id,
        version: 0,
        enabled: false,
        config: {
          title: "表单",
          description: "",
          fields: sheet!.definition.fields
            .filter((f) => !KINDS[f.kind].system)
            .map((f) => ({ field_id: f.id, required: true, description: "" })),
        },
      };
      try {
        await c.api.saveForm(id, form);
        await c.forms.refetch();
        choose(form.id);
      } catch (e) {
        fail(e);
      }
      return;
    }
    const next = newView(sheet!, kind);
    try {
      await c.update({
        ...sheet!,
        definition: {
          ...sheet!.definition,
          views: [...sheet!.definition.views, next],
        },
      });
      choose(next.id);
    } catch (e) {
      fail(e);
    }
  }
  function addRecord() {
    void c.change([{ id: newUUID(), version: 0, values: {} }]).catch(() => {});
  }
  function openRecord(row: Row) {
    setRecord(row);
  }
  function fieldAction(action: string, field: Field, anchor: Anchor) {
    setMenu(null);
    const index = sheet!.definition.fields.findIndex((f) => f.id === field.id);
    if (action === "color") setMenu({ kind: "color", field, anchor });
    if (action === "duplicates")
      void saveView({
        ...view!,
        highlight_duplicates: view!.highlight_duplicates.includes(field.id)
          ? view!.highlight_duplicates.filter((id) => id !== field.id)
          : [...view!.highlight_duplicates, field.id],
      }).catch(fail);
    if (action === "edit") setFieldEdit({ field, anchor });
    if (action === "left" || action === "right")
      setFieldEdit({
        field: newField(),
        anchor,
        index: index + (action === "right" ? 1 : 0),
      });
    if (action === "copy") {
      const next = {
        ...structuredClone(field),
        id: newUUID(),
        name: `${field.name} 副本`,
        copy_from: field.id,
      };
      void saveField(next, index + 1).catch(fail);
    }
    if (action === "hide")
      void saveView({
        ...view!,
        field_ids: view!.field_ids.filter((id) => id !== field.id),
      }).catch(fail);
    if (action === "delete") {
      const fields = sheet!.definition.fields.filter((f) => f.id !== field.id);
      const views = sheet!.definition.views.map((v) => ({
        ...v,
        field_ids: v.field_ids.filter((id) => id !== field.id),
        filters: v.filters.filter((f) => f.field_id !== field.id),
        sorts: v.sorts.filter((s) => s.field_id !== field.id),
        group_field_id: v.group_field_id === field.id ? "" : v.group_field_id,
        widths: Object.fromEntries(
          Object.entries(v.widths).filter(([id]) => id !== field.id),
        ),
        text_colors: Object.fromEntries(
          Object.entries(v.text_colors).filter(([id]) => id !== field.id),
        ),
        highlight_duplicates: v.highlight_duplicates.filter(
          (id) => id !== field.id,
        ),
      }));
      void c.update({ ...sheet!, definition: { fields, views } }).catch(fail);
    }
    if (action === "asc" || action === "desc")
      void saveView({
        ...view!,
        sorts: [{ field_id: field.id, descending: action === "desc" }],
      }).catch(fail);
    if (action === "group")
      void saveView({ ...view!, group_field_id: field.id }).catch(fail);
    if (action === "filter") setSettings({ mode: "filter", anchor });
  }
  const breadcrumb = (
    <nav className="document-breadcrumb sheet-breadcrumb" aria-label="文档位置">
      <Link to={`/collections/${sheet.collection_id}`}>
        <BookOpen size={15} />
        <span>{notebook.data?.title ?? "笔记本"}</span>
      </Link>
      <ChevronRight size={13} />
      {titleEdit ? (
        <TextInput
          autoFocus
          aria-label="数据表名称"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setTitleEdit(false);
          }}
          onBlur={() => {
            setTitleEdit(false);
            if (title.trim() && title !== sheet.title)
              void c.update({ ...sheet, title }).catch(fail);
          }}
        />
      ) : (
        <ActionButton
          size="sm"
          className="sheet-title"
          disabled={!canEdit}
          onClick={() => {
            setTitle(sheet.title);
            setTitleEdit(true);
          }}
        >
          {sheet.title}
        </ActionButton>
      )}
    </nav>
  );
  const actions = (
    <div className="document-header-actions">
      <span className="sheet-save-state">
        {c.busy ? (
          "保存中…"
        ) : c.hasPending || cellDirty ? (
          "待保存"
        ) : (
          <>
            <Check size={12} />
            已保存
          </>
        )}
      </span>
      <span className="document-header-divider" aria-hidden="true" />
      {canEdit && (
        <ShareButton
          notebookId={sheet.collection_id}
          noteId={sheet.document_id}
          title={sheet.title}
        />
      )}
      <ActionButton
        className="document-comment-trigger"
        aria-label="评论"
        aria-expanded={commentsOpen}
        onClick={() => setCommentsOpen(!commentsOpen)}
      >
        <MessageSquare size={16} />
        <span>评论</span>
      </ActionButton>
      <Dropdown>
        <ActionButton aria-label="更多文档操作">
          <MoreHorizontal size={18} />
        </ActionButton>
        <Dropdown.Popover
          placement="bottom end"
          className="document-actions-popover"
          offset={6}
        >
          <Dropdown.Menu
            aria-label="文档操作"
            onAction={(key) => {
              if (key === "copy")
                void navigator.clipboard.writeText(location.href).catch(fail);
              if (key === "archive")
                void (async () => {
                  await preparePendingNavigation();
                  const owner = await getNotebook(sheet.collection_id, c.auth);
                  await archiveNote.mutateAsync({
                    id: sheet.document_id,
                    archived: true,
                    expected_directory_version: owner.directory_version,
                  });
                  navigate(`/collections/${sheet.collection_id}`);
                })().catch(fail);
            }}
          >
            <Dropdown.Item id="copy" textValue="复制链接">
              <Copy size={15} />
              <Label>复制链接</Label>
            </Dropdown.Item>
            {canEdit && (
              <Dropdown.Item
                id="archive"
                textValue="归档文档"
                isDisabled={c.busy || c.hasPending || archiveNote.isPending}
              >
                <Archive size={15} />
                <Label>归档文档</Label>
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
  const content = (
    <div
      className={`sheet-workspace${embedded ? " sheet-embedded-workspace" : ""}`}
    >
      <nav className="sheet-view-tabs" aria-label="视图">
        <div role="tablist">
          {sheet.definition.views.map((v) => (
            <div
              className={`sheet-tab${!activeForm && view.id === v.id ? " active" : ""}`}
              key={v.id}
            >
              {rename?.id === v.id ? (
                <input
                  className="sheet-tab-rename"
                  aria-label="视图名称"
                  autoFocus
                  value={rename.name}
                  onChange={(e) =>
                    setRename({ ...rename, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRename(null);
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={() => {
                    if (rename.name.trim())
                      void saveView(rename)
                        .then(() => setRename(null))
                        .catch(fail);
                  }}
                />
              ) : (
                <ActionButton
                  size="sm"
                  role="tab"
                  aria-selected={!activeForm && view.id === v.id}
                  onClick={() => choose(v.id)}
                >
                  {v.kind === "grid" ? (
                    <Table2 size={14} />
                  ) : (
                    <LayoutGrid size={14} />
                  )}
                  {v.name}
                </ActionButton>
              )}
              {canEdit && (
                <ActionButton
                  size="sm"
                  aria-label={`${v.name}操作`}
                  onClick={(e) =>
                    setMenu({
                      kind: "view",
                      view: v,
                      anchor: anchorAt(e.currentTarget),
                    })
                  }
                >
                  <MoreHorizontal size={14} />
                </ActionButton>
              )}
            </div>
          ))}
          {c.forms.data?.map((f) => (
            <div
              className={`sheet-tab${activeForm?.id === f.id ? " active" : ""}`}
              key={f.id}
            >
              <ActionButton
                size="sm"
                role="tab"
                aria-selected={activeForm?.id === f.id}
                onClick={() => choose(f.id)}
              >
                <FileInput size={14} />
                {f.config.title}
              </ActionButton>
            </div>
          ))}
        </div>
        {canEdit && (
          <ActionButton
            size="sm"
            aria-label="添加视图"
            onClick={(e) =>
              setMenu({ kind: "add", anchor: anchorAt(e.currentTarget) })
            }
          >
            <Plus size={16} />
          </ActionButton>
        )}
      </nav>
      {c.error && (
        <div className="sheet-notice" role="alert">
          <span>{c.error}</span>
          {c.hasPending && (
            <>
              <ActionButton
                size="sm"
                disabled={c.busy}
                onClick={() => void c.change().catch(() => {})}
              >
                重试保存
              </ActionButton>
              <ActionButton
                size="sm"
                onClick={() => {
                  const blob = new Blob(
                    [sessionStorage.getItem(c.draftKey) ?? ""],
                    { type: "application/json" },
                  );
                  const url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "table-draft.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                导出本机修改
              </ActionButton>
              <ActionButton size="sm" onClick={c.discard}>
                放弃本次修改
              </ActionButton>
            </>
          )}
        </div>
      )}
      {activeForm ? (
        <SheetForms
          key={activeForm.id}
          controller={c}
          form={activeForm}
          fields={fields}
          readOnly={!canEdit}
        />
      ) : (
        <>
          <div className="sheet-toolbar">
            {(
              [
                { mode: "columns", icon: Settings2, label: "字段管理" },
                { mode: "filter", icon: Filter, label: "筛选" },
                { mode: "group", icon: Group, label: "分组" },
                { mode: "sort", icon: ArrowDown, label: "排序" },
                {
                  mode: "height",
                  icon: AlignVerticalSpaceAround,
                  label: "行高",
                },
              ] as const
            ).map(({ mode, icon: Icon, label }) => (
              <ActionButton
                size="sm"
                key={mode}
                disabled={!canEdit || c.busy}
                className={
                  (mode === "filter" && view.filters.length) ||
                  (mode === "sort" && view.sorts.length) ||
                  (mode === "group" && view.group_field_id)
                    ? "is-set"
                    : ""
                }
                onClick={(e) =>
                  setSettings({ mode, anchor: anchorAt(e.currentTarget) })
                }
              >
                <Icon size={14} />
                {label}
              </ActionButton>
            ))}
            <label className="sheet-search">
              <Search size={14} />
              <input
                aria-label="搜索记录"
                placeholder="搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {canEdit && (
              <ActionButton size="sm" disabled={c.busy} onClick={addRecord}>
                <Plus size={14} />
                添加记录
              </ActionButton>
            )}
            <span className="sheet-toolbar-spacer" />
            {canEdit && (
              <ActionButton size="sm" onClick={() => void addView("form")}>
                <FileInput size={14} />
                生成表单
              </ActionButton>
            )}
          </div>
          {c.pages.error && (
            <p className="sheet-error" role="alert">
              {c.pages.error.message}
              <ActionButton size="sm" onClick={() => void c.pages.refetch()}>
                重试
              </ActionButton>
            </p>
          )}
          {view.kind === "grid" ? (
            <SheetGrid
              duplicates={Object.fromEntries(
                view.highlight_duplicates.map((id) => [
                  id,
                  c.pages.data?.pages.flatMap(
                    (p) => p.duplicate_ids[id] ?? [],
                  ) ?? [],
                ]),
              )}
              rows={c.rows}
              confirmedRows={c.confirmedRows}
              rowOffset={c.rowOffset}
              total={c.stats.data?.total}
              fields={fields}
              view={view}
              readOnly={!canEdit}
              busy={c.busy || c.hasPending}
              hasPending={c.hasPending}
              auth={c.auth}
              onChange={c.change}
              onFieldMenu={(field, anchor) =>
                setMenu({ kind: "field", field, anchor })
              }
              onNewField={(anchor) =>
                setFieldEdit({ field: newField(), anchor })
              }
              onWidth={(id, width) =>
                void saveView({
                  ...view,
                  widths: { ...view.widths, [id]: width },
                }).catch(fail)
              }
              onCreateOption={async (field, label) => {
                const existing = field.options.find((o) => o.label === label);
                if (existing) return existing.id;
                const option = { id: newUUID(), label, color: "purple" };
                await saveField({
                  ...field,
                  options: [...field.options, option],
                });
                return option.id;
              }}
              onInspect={openRecord}
              onDraftChange={setCellDirty}
              onAdd={addRecord}
              hasMore={c.pages.hasNextPage}
              loading={c.pages.isFetching}
              onMore={() => c.pages.fetchNextPage()}
              onError={c.setError}
            />
          ) : (
            <SheetBoard
              controller={c}
              fields={fields}
              readOnly={!canEdit}
              onRecord={openRecord}
            />
          )}
          <footer className="sheet-statusbar">
            <span>
              {c.stats.data
                ? `${c.stats.data.total} 条记录`
                : "正在读取记录数…"}
            </span>
            <ActionButton size="sm" onClick={() => void c.refresh()}>
              刷新
            </ActionButton>
          </footer>
        </>
      )}
      {menu && (
        <Popover
          anchor={menu.anchor}
          label={menu.kind === "field" ? "列操作" : "视图操作"}
          onClose={() => setMenu(null)}
        >
          <div className="sheet-menu" role="menu">
            {menu.kind === "color" &&
              COLORS.map((color, i) => (
                <ActionButton
                  size="sm"
                  role="menuitem"
                  key={color}
                  style={{ color: `var(--sheet-ink-${color})` }}
                  onClick={() => {
                    setMenu(null);
                    void saveView({
                      ...view,
                      text_colors: {
                        ...view.text_colors,
                        [menu.field!.id]: color,
                      },
                    }).catch(fail);
                  }}
                >
                  {["绿色", "黄色", "蓝色", "紫色", "粉色", "默认"][i]}
                </ActionButton>
              ))}
            {menu.kind === "add" && (
              <>
                {(["grid", "kanban", "form"] as const).map((kind) => (
                  <ActionButton
                    size="sm"
                    role="menuitem"
                    key={kind}
                    onClick={() => void addView(kind)}
                  >
                    {kind === "grid" ? (
                      <Table2 size={15} />
                    ) : kind === "kanban" ? (
                      <LayoutGrid size={15} />
                    ) : (
                      <FileInput size={15} />
                    )}
                    {kind === "grid"
                      ? "表格视图"
                      : kind === "kanban"
                        ? "看板视图"
                        : "表单"}
                  </ActionButton>
                ))}
              </>
            )}
            {menu.kind === "view" && (
              <>
                <ActionButton
                  size="sm"
                  role="menuitem"
                  onClick={() => {
                    setRename(menu.view!);
                    setMenu(null);
                  }}
                >
                  <Pencil size={14} />
                  重命名视图
                </ActionButton>
                <ActionButton
                  size="sm"
                  role="menuitem"
                  onClick={() => {
                    const next = {
                      ...structuredClone(menu.view!),
                      id: newUUID(),
                      name: `${menu.view!.name} 副本`,
                    };
                    setMenu(null);
                    void c
                      .update({
                        ...sheet,
                        definition: {
                          ...sheet.definition,
                          views: [...sheet.definition.views, next],
                        },
                      })
                      .then(() => choose(next.id))
                      .catch(fail);
                  }}
                >
                  <Copy size={14} />
                  复制视图
                </ActionButton>
                <ActionButton
                  size="sm"
                  role="menuitem"
                  disabled={sheet.definition.views.length < 2}
                  onClick={() => {
                    const views = sheet.definition.views.filter(
                      (v) => v.id !== menu.view!.id,
                    );
                    setMenu(null);
                    void c
                      .update({
                        ...sheet,
                        definition: { ...sheet.definition, views },
                      })
                      .then(() => choose(views[0].id))
                      .catch(fail);
                  }}
                >
                  <Trash2 size={14} />
                  删除视图
                </ActionButton>
              </>
            )}
            {menu.kind === "field" &&
              [
                { id: "edit", label: "编辑列", icon: Pencil },
                { id: "copy", label: "复制列", icon: Copy },
                { id: "left", label: "向左插入列", icon: Plus },
                { id: "right", label: "向右插入列", icon: Plus },
                { id: "group", label: "按本列分组", icon: Group },
                { id: "filter", label: "按本列筛选", icon: Filter },
                { id: "asc", label: "升序", icon: ArrowUp },
                { id: "desc", label: "降序", icon: ArrowDown },
                { id: "duplicates", label: "高亮重复值", icon: Copy },
                { id: "color", label: "文本颜色", icon: Pencil },
                { id: "hide", label: "隐藏列", icon: Columns3 },
                { id: "delete", label: "删除列", icon: Trash2 },
              ].map((item) => (
                <ActionButton
                  size="sm"
                  role="menuitem"
                  className={
                    item.id === "delete" ? "sheet-danger-action" : undefined
                  }
                  key={item.id}
                  disabled={
                    c.busy ||
                    (item.id === "group" && menu.field!.kind !== "select") ||
                    (["asc", "desc", "duplicates"].includes(item.id) &&
                      KINDS[menu.field!.kind].multiple) ||
                    (item.id === "duplicates" &&
                      KINDS[menu.field!.kind].system) ||
                    (item.id === "delete" && fields.length <= 1) ||
                    (item.id === "hide" && view.field_ids.length <= 1)
                  }
                  onClick={() => fieldAction(item.id, menu.field!, menu.anchor)}
                >
                  <item.icon size={14} />
                  {item.label}
                </ActionButton>
              ))}
          </div>
        </Popover>
      )}
      {fieldEdit && (
        <FieldSettings
          field={fieldEdit.field}
          anchor={fieldEdit.anchor ?? anchorAt(document.activeElement!)}
          onSave={saveField}
          onClose={() => setFieldEdit(null)}
        />
      )}
      {settings && (
        <ViewSettings
          mode={settings.mode}
          anchor={settings.anchor}
          fields={fields}
          view={view}
          onSave={saveView}
          onClose={() => setSettings(null)}
        />
      )}
      {record && (
        <section className="sheet-record-panel" aria-label="记录详情">
          <header>
            <strong>记录详情</strong>
            <ActionButton size="sm" onClick={() => setRecord(null)}>
              收起
            </ActionButton>
          </header>
          {fields.map((field) => (
            <div key={field.id}>
              <span>{field.name}</span>
              <CellValue
                field={field}
                value={
                  (c.rows.find((r) => r.id === record.id) ?? record).values[
                    field.id
                  ]
                }
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
  if (embedded) return content;
  return (
    <WorkspaceShell
      sidebar={createNotebookSidebar(sheet.collection_id, sheet.document_id)}
      contextPanel={
        commentsOpen ? (
          <section className="sheet-comments-panel" aria-label="文档评论">
            <header>
              <strong>评论</strong>
              <ActionButton
                aria-label="收起评论"
                onClick={() => setCommentsOpen(false)}
              >
                <X size={16} />
              </ActionButton>
            </header>
            <Suspense fallback={<p>正在读取评论…</p>}>
              <DocumentComments
                noteId={sheet.document_id}
                currentUserId={userID}
                canManage={canEdit}
              />
            </Suspense>
          </section>
        ) : undefined
      }
      contentLayout="document"
      sectionTitle={breadcrumb}
      toolbar={<div className="sheet-header-actions">{actions}</div>}
    >
      {content}
    </WorkspaceShell>
  );
}
