import { releaseFeatures } from "../../shared/release-features";
import { ConfirmAction } from "../../shared/ui/ConfirmAction";
import { DraftActions } from "../../shared/ui/DraftActions";
import { Button } from "../../shared/ui/Button";

import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { useQuery } from "@tanstack/react-query";
import {
  AlignVerticalSpaceAround,
  Archive,
  ArrowDown,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  FileInput,
  Filter,
  Group,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Table2,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useStore } from "zustand";
import { authStore } from "../../shared/auth/auth-store";
import { newUUID } from "../../shared/ids";
import { preparePendingNavigation } from "../../shared/navigation/pending-navigation";
import { ActionButton } from "../../shared/ui/ActionButton";
import { EmbeddedSurface } from "../../shared/ui/EmbeddedSurface";
import { Tooltip } from "../../shared/ui/Tooltip";
import { TextInput } from "../../shared/ui/TextInput";
import { DocumentShell } from "../documents/DocumentShell";
import { createNotebookSidebar } from "../documents/NotebookSectionMenu";
import { getNotebook } from "../documents/api";
import { useArchiveNote, useNotebook } from "../documents/queries";
import { listMemberChoices } from "../members/api";
import { ShareButton } from "../sharing/ShareButton";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { CellValue } from "./Cell";
import { FieldSettings } from "./FieldSettings";
import { anchorAt, type Anchor } from "./Popover";
import { SheetBoard } from "./SheetBoard";
import { SheetForms } from "./SheetForms";
import { SheetGrid } from "./SheetGrid";
import { ViewSettings, type SettingsMode } from "./ViewSettings";
import {
  KINDS,
  newField,
  newView,
  type Field,
  type Form,
  type Row,
  type View,
} from "./model";
import "./sheets.css";
import { SheetWorkspaceMenu, type SheetMenu } from "./SheetWorkspaceMenu";
import { removeFieldDefinition, updateFieldDefinition } from "./definition";
import { useSheet } from "./use-sheet";

const DocumentComments = lazy(() =>
  import("../collaboration/DocumentCollaborationPanel").then((m) => ({
    default: m.DocumentComments,
  })),
);

export function SheetWorkspace({
  id,
  embedded = false,
  initialView = "",
  readOnly = false,
  onViewChange,
  embedKey,
}: {
  id: string;
  embedded?: boolean;
  embedKey?: string;
  initialView?: string;
  readOnly?: boolean;
  onViewChange?: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams(),
    [localView, setLocalView] = useState(initialView),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const selectedView = embedded ? localView : (params.get("view") ?? "");
  const c = useSheet(id, selectedView, query),
    canEdit =
      !readOnly &&
      canMutateWorkspaceContent(useStore(authStore, (s) => s.workspace));
  const [menu, setMenu] = useState<SheetMenu | null>(null),
    [fieldEdit, setFieldEdit] = useState<{
      field: Field;
      index?: number;
      relative?: { fieldID: string; after: boolean };
      anchor?: Anchor;
    } | null>(null),
    [settings, setSettings] = useState<{
      mode: SettingsMode;
      anchor: Anchor;
      fieldID?: string;
    } | null>(null);
  const [record, setRecord] = useState<Row | null>(null),
    [rename, setRename] = useState<View | null>(null),
    [titleEdit, setTitleEdit] = useState(false),
    [title, setTitle] = useState("");
  const members = useQuery({
    queryKey: ["sheet-members", c.auth.workspaceId],
    queryFn: ({ signal }) => listMemberChoices(c.auth, signal),
    staleTime: 60000,
  });
  const people = (members.data?.items ?? []).map((m) => ({
    id: m.user_id,
    label: m.display_name || m.email,
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
  const LoadingShell = embedded ? "div" : DocumentShell;
  if (!sheet || !view)
    return (
      <LoadingShell {...(!embedded ? { loading: true } : {})}>
        <div className="sheet-empty">
          {c.meta.error ? (
            <>

              <ActionButton size="sm" onClick={() => void c.meta.refetch()}>
                重试
              </ActionButton>
            </>
          ) : (
            "正在打开数据表…"
          )}
        </div>
      </LoadingShell>
    );
  const activeForm = releaseFeatures.sheetForms ? c.forms.data?.find((f) => f.id === selectedView) : undefined;
  const fail = (error: unknown) => {
    reportError(error);
    c.setError(error instanceof Error ? error.message : String(error));
  };
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
  async function saveField(next: Field, insertIndex?: number, relative = fieldEdit?.relative) {
    return c.update({ ...sheet!, definition: updateFieldDefinition(sheet!.definition, next, insertIndex ?? fieldEdit?.index, relative) });
  }

  async function addView(kind: "grid" | "kanban" | "form") {
    if (kind === "form" && !releaseFeatures.sheetForms) return;
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
    void c.change([{ id: newUUID(), version: 0, values: {} }]).catch(fail);
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
        relative: { fieldID: field.id, after: action === "right" },
      });
    if (action === "copy") {
      const next = {
        ...structuredClone(field),
        id: newUUID(),
        name: `${field.name} 副本`,
        copy_from: field.id,
      };
      void saveField(next, index + 1, { fieldID: field.id, after: true }).catch(fail);
    }
    if (action === "hide")
      void saveView({
        ...view!,
        field_ids: view!.field_ids.filter((id) => id !== field.id),
      }).catch(fail);
    if (action === "delete") {
      void c.update({ ...sheet!, definition: removeFieldDefinition(sheet!.definition, field.id) }).catch(fail);
    }

    if (action === "asc" || action === "desc")
      void saveView({
        ...view!,
        sorts: [{ field_id: field.id, descending: action === "desc" }],
      }).catch(fail);
    if (action === "group")
      void saveView({ ...view!, group_field_id: field.id }).catch(fail);
    if (action === "filter") setSettings({ mode: "filter", anchor, fieldID: field.id });
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
    <div className="document-header-actions">{c.hasPending ? <DraftActions><section><h3 className="mb-2 text-sm font-semibold">当前修改</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={c.busy}
                onClick={() => void c.change().catch(fail)}
              >
                重试保存
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const blob = new Blob([c.exportDraft()], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "table-draft.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                导出本机修改
              </Button>
              <ConfirmAction title="放弃本次修改" description="未保存的表格修改将被清除。需要保留时，请先导出本机修改。" confirmLabel="确认放弃" disabled={c.busy} onConfirm={c.discard}>
                <Button size="sm" disabled={c.busy}>放弃本次修改</Button>
              </ConfirmAction>
            </div>
          </section></DraftActions> : null}
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
        (releaseFeatures.documentSharing ? <ShareButton
          notebookId={sheet.collection_id}
          noteId={sheet.document_id}
          title={sheet.title}
        /> : null)
      )}
      {releaseFeatures.documentCollaboration && <ActionButton
        className="document-comment-trigger"
        aria-label="评论"
        aria-expanded={commentsOpen}
        onClick={() => setCommentsOpen(!commentsOpen)}
      >
        <MessageSquare size={16} />
        <span>评论</span>
      </ActionButton>}
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
          {releaseFeatures.sheetForms && c.forms.data?.map((f) => (
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
        {embedded && <span className="sheet-embed-save" role="status">{!canEdit ? "只读" : c.error ? "保存失败" : c.busy ? "保存中…" : c.hasPending || cellDirty ? "待保存" : "已保存"}</span>}
      </nav>
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
              <Tooltip key={mode} label={label}><ActionButton
                size="sm"
                aria-label={label}
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
                <span className="sheet-tool-label">{label}</span>
              </ActionButton></Tooltip>
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
            {canEdit && releaseFeatures.sheetForms && (
              <ActionButton size="sm" aria-label="生成表单" title="生成表单" onClick={() => void addView("form")}>
                <FileInput size={14} />
                <span className="sheet-tool-label">生成表单</span>
              </ActionButton>
            )}
          </div>

          {view.kind === "grid" ? (
            <SheetGrid
              manualOrder={!view.sorts.length && !view.group_field_id && !view.filters.length && !query}
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
              draftKey={c.draftKey}
              discardVersion={c.discardVersion}
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
              onRefresh={c.refresh}
              onError={fail}
            />
          ) : (
            <SheetBoard
              controller={c}
              fields={fields}
              readOnly={!canEdit}
              onRecord={openRecord}
            />
          )}
          {view.kind !== "grid" && (
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
          )}
        </>
      )}
      {menu && <SheetWorkspaceMenu menu={menu} busy={c.busy} fieldCount={fields.length}
        visibleFieldCount={view.field_ids.length} viewCount={sheet.definition.views.length}
        onClose={() => setMenu(null)} onRename={setRename} onAdd={kind => void addView(kind)}
        onColor={(fieldID, color) => { void saveView({ ...view, text_colors: { ...view.text_colors, [fieldID]: color } }).catch(fail); }}
        onDuplicate={source => {
          const next = { ...structuredClone(source), id: newUUID(), name: `${source.name} 副本` };
          void c.update({ ...sheet, definition: { ...sheet.definition, views: [...sheet.definition.views, next] } }).then(() => choose(next.id)).catch(fail);
        }}
        onDelete={source => {
          const views = sheet.definition.views.filter(candidate => candidate.id !== source.id);
          void c.update({ ...sheet, definition: { ...sheet.definition, views } }).then(() => choose(views[0].id)).catch(fail);
        }} onFieldAction={fieldAction} />}
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
          initialFieldID={settings.fieldID}
          onFieldAction={(action, field, anchor) => { setSettings(null); fieldAction(action, field, anchor); }}
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
  if (embedded) return <EmbeddedSurface kind="table" label={sheet.title}
    surfaceKey={`${c.auth.workspaceId}:${embedKey || id}`}
    defaultHeight={view.kind === "grid" ? Math.min(520, 150 + Math.max(3, c.rows.length) * view.row_height) : 460}>
    {content}
  </EmbeddedSurface>;
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
              {releaseFeatures.documentCollaboration && <DocumentComments
                noteId={sheet.document_id}
                currentUserId={userID}
                canManage={canEdit}
              />}
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
