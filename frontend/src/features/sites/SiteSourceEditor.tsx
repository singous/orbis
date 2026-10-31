import { LoadingState } from "../../shared/ui/LoadingState";
import { Input } from "@orbis/ui/input";
import { RadioGroup, RadioGroupItem } from "@orbis/ui/radio-group";
import { SiteActionButton as ActionButton } from "./SiteManagementLayout";
import { SiteField, SiteInfoPanel, SiteNotice, SiteSectionHeading, SiteReorderControls } from "./SiteManagementLayout";
import { SelectField } from "../../shared/ui/SelectField";
import { Plus } from "../../shared/ui/icons";

import { useNoteTree, useNotebooks } from "../documents/queries";
import type { NotebookSource, SiteSource, SiteSources } from "./schemas";
import { flattenNoteTree, formatSavedTime, MANUAL_SOURCE, sourceOrManual } from "./source-model";
import { SiteSourceTree } from "./SiteSourceTree";

function SourceBinding({
  binding,
  index,
  source,
  sources,
  saved,
  disabled,
  notebookOptions,
  onChange,
  onSourceChange,
  onRemove,
  onMove,
}: {
  binding: NotebookSource;
  index: number;
  source: SiteSource;
  sources?: SiteSources;
  saved: boolean;
  disabled: boolean;
  notebookOptions: Array<{ id: string; title: string }>;
  onChange: (binding: NotebookSource) => void;
  onSourceChange: (source: SiteSource) => void;
  onRemove: () => void;
  onMove: (direction: number) => void;
}) {
  const tree = useNoteTree(binding.notebook_id);
  const flatTree = flattenNoteTree(tree.data?.items ?? []);
  const notebook = notebookOptions.find((item) => item.id === binding.notebook_id);
  return <article className="mb-3.5 overflow-hidden rounded-[13px] border border-ob-border bg-ob-card">
    <header className="flex items-center justify-between gap-4 border-b border-ob-border px-[15px] py-[13px]">
      <div className="grid gap-[2px]"><strong className="text-sm font-semibold">{notebook?.title ?? "来源笔记本不可用"}</strong><span className="text-xs tracking-[.05em] text-ob-muted-foreground uppercase">来源 {index + 1}</span></div>
      {!disabled ? <SiteReorderControls appearance="source" first={index === 0} last={index === source.notebooks.length - 1} upLabel={`上移来源 ${index + 1}`} downLabel={`下移来源 ${index + 1}`} removeLabel={`移除来源 ${index + 1}`} onMove={onMove} onRemove={onRemove} /> : null}
    </header>
    <div className="grid grid-cols-1 gap-[11px] border-b border-ob-border px-[15px] py-3.5 min-[721px]:grid-cols-3 [&_label]:grid [&_label]:gap-1.5 [&_label]:text-sm [&_label]:text-ob-muted-foreground [&_input]:min-w-0">
      <SelectField label="来源笔记本" aria-label={`来源笔记本 ${index + 1}`} disabled={disabled} value={binding.notebook_id} onChange={(notebook_id) => onChange({ notebook_id, root_note_id: null, label: binding.label ?? null })} options={[...(!notebook ? [{ value: binding.notebook_id, label: "当前来源不可用" }] : []), ...notebookOptions.map((item) => ({ value: item.id, label: item.title }))]} />
      <SelectField label="内容范围" aria-label={`内容范围 ${index + 1}`} disabled={disabled || tree.isPending} value={binding.root_note_id ?? ""} onChange={(rootId) => onChange({ ...binding, root_note_id: rootId || null })} options={[{ value: "", label: "整个笔记本" }, ...flatTree.map((item) => ({ value: item.id, label: item.title }))]} />
      <SiteField variant="source">栏目名称<Input aria-label={`栏目名称 ${index + 1}`} disabled={disabled} value={binding.label ?? ""} placeholder={notebook?.title ?? "默认使用笔记本名称"} onChange={(event) => onChange({ ...binding, label: event.target.value || null })} /></SiteField>
    </div>
    {tree.isPending ? <LoadingState label="正在加载真实文档树…" compact /> : tree.isError ? null : <SiteSourceTree items={tree.data.items} rootNoteId={binding.root_note_id} source={source} resolved={saved ? sources : undefined} disabled={disabled} onChange={onSourceChange} />}
  </article>;
}

export function SiteSourceEditor({
  value,
  onChange,
  disabled = false,
  saved = false,
  sources,
  savedAtMs,
}: {
  value?: SiteSource;
  onChange: (source: SiteSource) => void;
  disabled?: boolean;
  saved?: boolean;
  sources?: SiteSources;
  savedAtMs?: number;
}) {
  const source = sourceOrManual(value);
  const notebooks = useNotebooks();
  const notebookOptions = notebooks.data?.items ?? [];
  const latestSourceUpdate = sources?.pages.reduce<number | null>((latest, page) => page.updated_at_ms !== null && (latest === null || page.updated_at_ms > latest) ? page.updated_at_ms : latest, null) ?? null;

  function setMode(kind: SiteSource["kind"]) {
    if (kind === "manual") onChange(MANUAL_SOURCE);
    else onChange({ ...source, kind: "notebooks", notebooks: source.notebooks.length ? source.notebooks : notebookOptions[0] ? [{ notebook_id: notebookOptions[0].id, root_note_id: null, label: null }] : [] });
  }

  function updateBinding(index: number, binding: NotebookSource) {
    onChange({ ...source, notebooks: source.notebooks.map((item, position) => position === index ? binding : item) });
  }

  function moveBinding(index: number, direction: number) {
    const next = [...source.notebooks];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange({ ...source, notebooks: next });
  }

  return <section className="min-w-0" aria-labelledby="site-source-title">
    <SiteSectionHeading title={<span id="site-source-title">内容来源</span>} description="关联笔记本后，新文档与标题更新会在下次预览时自动出现。" />
    <RadioGroup<SiteSource["kind"]> className="m-0 mb-5 flex flex-row flex-wrap gap-5" aria-label="内容来源方式" name="site-source-kind" aria-orientation="horizontal" disabled={disabled} value={source.kind} onValueChange={setMode}>
      <RadioGroupItem value="notebooks">关联笔记本</RadioGroupItem>
      <RadioGroupItem value="manual">手动选择</RadioGroupItem>
    </RadioGroup>
    {source.kind === "manual" ? <SiteNotice title="手动选择目录" description="继续使用下方站点目录。切换到笔记本来源不会删除这些手选项，切回后仍可继续编辑。" /> : <>
      {notebooks.isPending ? <LoadingState label="正在加载笔记本…" compact /> : null}
      {source.notebooks.map((binding, index) => <SourceBinding
        key={`${binding.notebook_id}-${index}`}
        binding={binding}
        index={index}
        source={source}
        sources={sources}
        saved={saved}
        disabled={disabled}
        notebookOptions={notebookOptions}
        onChange={(next) => updateBinding(index, next)}
        onSourceChange={onChange}
        onRemove={() => onChange({ ...source, notebooks: source.notebooks.filter((_, position) => position !== index) })}
        onMove={(direction) => moveBinding(index, direction)}
      />)}
      {!source.notebooks.length ? <SiteNotice className="mb-3.5" title="尚未关联来源" description="请明确添加一个笔记本，或切换到手动选择后再保存。" /> : null}
      {!disabled && notebookOptions.length ? <ActionButton className="mt-[2px] inline-flex items-center gap-1.5 text-xs enabled:hover:bg-ob-secondary text-ob-muted-foreground" onClick={() => {
        const next = notebookOptions.find((item) => !source.notebooks.some((binding) => binding.notebook_id === item.id)) ?? notebookOptions[0];
        onChange({ ...source, notebooks: [...source.notebooks, { notebook_id: next.id, root_note_id: null, label: null }] });
      }}><Plus size={14} />添加来源</ActionButton> : null}
      <SiteInfoPanel className="mt-[17px] flex flex-wrap justify-between gap-x-4 gap-y-[7px] text-xs text-ob-muted-foreground">
        <span>{saved ? `来源配置已保存${savedAtMs ? ` · ${formatSavedTime(savedAtMs)}` : ""}` : "来源配置尚未保存，公开路径将在保存后生成"}</span>
        {saved && sources ? <span>当前解析 {sources.pages.length} 篇 · 排除 {sources.excluded_count} 篇</span> : null}
        {saved && latestSourceUpdate ? <span>来源内容更新 · {formatSavedTime(latestSourceUpdate)}</span> : null}
        {saved && !sources ? <span>来源解析暂不可用，草稿配置仍可编辑</span> : null}
      </SiteInfoPanel>
    </>}
  </section>;
}
