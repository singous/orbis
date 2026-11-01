import { cn } from "@orbis/ui/cn";
import { sheetActionClassName, sheetWorkspaceClassName, sheetTabClassName, sheetStatusBarClassName } from "./sheet-chrome";
import { documentActionsMenuClassName } from "@/features/documents/document-layout";
import { documentBreadcrumbClassName, documentHeaderActionsClassName, documentHeaderDividerClassName, documentCommentTriggerClassName } from "../documents/editor/document-chrome";
import { releaseFeatures } from "../../shared/release-features";
import { reportError } from "../../shared/api/request-feedback";
import { ConfirmAction } from "../../shared/ui/ConfirmAction";
import { DraftActions } from "../../shared/ui/DraftActions";
import { Button } from "../../shared/ui/Button";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orbis/ui/dropdown-menu";
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
} from "@orbis/ui/icons";
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
        <div className="px-8 py-16 text-center text-(--ob-page-muted-foreground)">
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
    <nav className={cn(documentBreadcrumbClassName, "sheet-breadcrumb text-(--ob-page-muted-foreground) [&.sheet-breadcrumb]:gap-2.5 [&.sheet-breadcrumb>svg]:text-ob-primary")} aria-label="文档位置">
      <Link to={`/collections/${sheet.collection_id}`}>
        <BookOpen size={15} />
        <span>{notebook.data?.title ?? "笔记本"}</span>
      </Link>
      <ChevronRight size={13} />
      {titleEdit ? (
        <TextInput
          autoFocus
          className="w-[min(340px,40vw)]"
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
          className={cn(sheetActionClassName, "sheet-title max-w-[440px] justify-start overflow-hidden text-ellipsis text-ob-foreground [@media(max-width:760px)]:max-w-[200px]")}
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
  const draftActions = c.hasPending ? <DraftActions><section><h3 className="mb-2 text-sm font-semibold">当前修改</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={c.busy || !canEdit}
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
          </section></DraftActions> : null;
  const actions = (
    <div className={documentHeaderActionsClassName}>{draftActions}
      <span className="flex items-center gap-[5px] whitespace-nowrap text-[12px] text-(--ob-page-muted-foreground) [@media(max-width:760px)]:hidden">
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
      <span className={documentHeaderDividerClassName} aria-hidden="true" />
      {canEdit && (
        (releaseFeatures.documentSharing ? <ShareButton
          notebookId={sheet.collection_id}
          noteId={sheet.document_id}
          title={sheet.title}
        /> : null)
      )}
      {releaseFeatures.documentCollaboration && <ActionButton
        className={cn(sheetActionClassName, documentCommentTriggerClassName)}
        aria-label="评论"
        aria-expanded={commentsOpen}
        onClick={() => setCommentsOpen(!commentsOpen)}
      >
        <MessageSquare size={16} />
        <span>评论</span>
      </ActionButton>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><ActionButton className={cn(sheetActionClassName)} aria-label="更多文档操作">
          <MoreHorizontal size={18} />
        </ActionButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={documentActionsMenuClassName} aria-label="文档操作">
          <DropdownMenuItem textValue="复制链接" onSelect={() => { void navigator.clipboard.writeText(location.href).catch(fail); }}>
            <Copy size={15} /><span>复制链接</span>
          </DropdownMenuItem>
          {canEdit && <DropdownMenuItem textValue="归档文档" disabled={c.busy || c.hasPending || archiveNote.isPending} onSelect={() => {
            void (async () => {
              await preparePendingNavigation();
              const owner = await getNotebook(sheet.collection_id, c.auth);
              await archiveNote.mutateAsync({ id: sheet.document_id, archived: true, expected_directory_version: owner.directory_version });
              navigate(`/collections/${sheet.collection_id}`);
            })().catch(fail);
          }}>
            <Archive size={15} /><span>归档文档</span>
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const content = (
    <div
      className={cn(sheetWorkspaceClassName, embedded && "sheet-embedded-workspace h-full")}
    >
      <nav className={cn("sheet-view-tabs flex shrink-0 items-stretch gap-0 overflow-x-auto pt-1 [&>*]:shrink-0 in-[.embed-table:not(.is-expanded)]:pr-12", embedded ? "min-h-10 px-2.5" : "min-h-11 px-2 [@media(max-width:760px)]:px-3")} aria-label="视图">
        <div className="flex items-stretch gap-0" role="tablist">
          {sheet.definition.views.map((v) => (
            <div
              className={cn(sheetTabClassName, !activeForm && view.id === v.id && "active border-(--ob-sheet-chrome-border) bg-(--ob-sheet-toolbar-bg)")}
              key={v.id}
            >
              {rename?.id === v.id ? (
                <input
                  className="w-[120px] border-b border-ob-ring bg-transparent p-[5px] outline-none"
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
                <ActionButton className={cn(sheetActionClassName, "text-ob-foreground [&>svg]:text-(--ob-page-muted-foreground) [&[aria-selected=true]>svg]:text-(--sheet-selection-ink)")}
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
                <ActionButton className={cn(sheetActionClassName, "min-w-[26px] px-[5px] pointer-coarse:min-w-(--ob-control-height-touch)")}
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
              className={cn(sheetTabClassName, activeForm?.id === f.id && "active border-(--ob-sheet-chrome-border) bg-(--ob-sheet-toolbar-bg)")}
              key={f.id}
            >
              <ActionButton className={cn(sheetActionClassName, "text-ob-foreground [&>svg]:text-(--ob-page-muted-foreground) [&[aria-selected=true]>svg]:text-(--sheet-selection-ink)")}
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
          <ActionButton className={cn(sheetActionClassName)}
            size="sm"
            aria-label="添加视图"
            onClick={(e) =>
              setMenu({ kind: "add", anchor: anchorAt(e.currentTarget) })
            }
          >
            <Plus size={16} />
          </ActionButton>
        )}
        {embedded && <span className="ml-auto whitespace-nowrap px-2 text-[11px] text-(--ob-page-muted-foreground)" role="status">{!canEdit ? "只读" : c.error ? "保存失败" : c.busy ? "保存中…" : c.hasPending || cellDirty ? "待保存" : "已保存"}</span>}
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
          <div className={cn("sheet-toolbar flex shrink-0 items-center gap-1 border-b border-b-(--ob-sheet-chrome-border) bg-(--ob-sheet-toolbar-bg) py-1.5 whitespace-nowrap overscroll-x-contain", embedded ? "min-h-10 flex-wrap overflow-visible px-2.5" : "min-h-11 overflow-x-auto px-5 [@media(max-width:760px)]:px-3")}>
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
                className={cn(sheetActionClassName, embedded && "min-w-[30px] px-[7px]", (mode === "filter" && view.filters.length) ||
                  (mode === "sort" && view.sorts.length) ||
                  (mode === "group" && view.group_field_id)
                    ? "is-set bg-(--ob-page-accent-soft) text-ob-primary"
                    : "")}
                onClick={(e) =>
                  setSettings({ mode, anchor: anchorAt(e.currentTarget) })
                }
              >
                <Icon size={14} />
                <span className={cn("sheet-tool-label", embedded && "hidden in-[.embed-surface.is-expanded]:inline")}>{label}</span>
              </ActionButton></Tooltip>
            ))}
            <label className={cn("flex max-w-[190px] items-center gap-[7px] rounded-lg border border-(--ob-sheet-chrome-border) px-[9px] py-[5px] text-(--ob-page-muted-foreground) focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ob-ring pointer-coarse:min-h-(--ob-control-height-touch)", embedded ? "min-w-20 flex-1" : "ml-2 min-w-[110px] shrink-0")}>
              <Search size={14} />
              <input
                className="w-full min-w-0 bg-transparent text-[12px] text-ob-foreground outline-none"
                aria-label="搜索记录"
                placeholder="搜索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {canEdit && (
              <ActionButton className={cn(sheetActionClassName, embedded && "min-w-[30px] px-[7px]")} size="sm" disabled={c.busy} onClick={addRecord}>
                <Plus size={14} />
                添加记录
              </ActionButton>
            )}
            <span className="sheet-toolbar-spacer flex-1" />
            {canEdit && releaseFeatures.sheetForms && (
              <ActionButton className={cn(sheetActionClassName, embedded && "min-w-[30px] px-[7px]")} size="sm" aria-label="生成表单" title="生成表单" onClick={() => void addView("form")}>
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
            <footer className={sheetStatusBarClassName}>
              <span>
                {c.stats.data
                  ? `${c.stats.data.total} 条记录`
                  : "正在读取记录数…"}
              </span>
              <ActionButton className={cn(sheetActionClassName)} size="sm" onClick={() => void c.refresh()}>
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
        <section className={cn("sheet-record-panel flex-none overflow-auto border-t border-t-ob-border in-[.workspace-shell]:border-t-ob-workspace-outline px-5 py-4 [&>header]:flex [&>header]:items-center [&>header]:justify-between [&>div]:flex [&>div]:gap-6 [&>div]:py-2 [&>div>span:first-child]:w-25 [&>div>span:first-child]:text-(--ob-page-muted-foreground)", embedded ? "absolute inset-y-0 right-0 left-auto z-25 max-h-[120px] max-w-[min(400px,100%)] bg-ob-card" : "max-h-[280px]")} aria-label="记录详情">
          <header>
            <strong>记录详情</strong>
            <ActionButton className={cn(sheetActionClassName)} size="sm" onClick={() => setRecord(null)}>
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
    actions={draftActions}
    defaultHeight={view.kind === "grid" ? Math.min(520, 150 + Math.max(3, c.rows.length) * view.row_height) : 460}>
    {content}
  </EmbeddedSurface>;
  return (
    <WorkspaceShell
      sidebar={createNotebookSidebar(sheet.collection_id, sheet.document_id)}
      contextPanel={
        commentsOpen ? (
          <section className="p-4 [&>header]:mb-4 [&>header]:flex [&>header]:items-center [&>header]:justify-between" aria-label="文档评论">
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
      toolbar={<div className="sheet-header-actions flex items-center gap-2">{actions}</div>}
    >
      {content}
    </WorkspaceShell>
  );
}
