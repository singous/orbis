import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

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
  return <article className="site-source-binding">
    <header>
      <div><strong>{notebook?.title ?? "来源笔记本不可用"}</strong><span>来源 {index + 1}</span></div>
      {!disabled ? <div className="site-source-order-actions">
        <button type="button" aria-label={`上移来源 ${index + 1}`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
        <button type="button" aria-label={`下移来源 ${index + 1}`} disabled={index === source.notebooks.length - 1} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
        <button type="button" aria-label={`移除来源 ${index + 1}`} onClick={onRemove}><Trash2 size={14} /></button>
      </div> : null}
    </header>
    <div className="site-source-binding-fields">
      <label>来源笔记本<select aria-label={`来源笔记本 ${index + 1}`} disabled={disabled} value={binding.notebook_id} onChange={(event) => onChange({ notebook_id: event.target.value, root_note_id: null, label: binding.label ?? null })}>
        {!notebook ? <option value={binding.notebook_id}>当前来源不可用</option> : null}
        {notebookOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <label>内容范围<select aria-label={`内容范围 ${index + 1}`} disabled={disabled || tree.isPending} value={binding.root_note_id ?? ""} onChange={(event) => onChange({ ...binding, root_note_id: event.target.value || null })}>
        <option value="">整个笔记本</option>
        {flatTree.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <label>栏目名称<input aria-label={`栏目名称 ${index + 1}`} disabled={disabled} value={binding.label ?? ""} placeholder={notebook?.title ?? "默认使用笔记本名称"} onChange={(event) => onChange({ ...binding, label: event.target.value || null })} /></label>
    </div>
    {tree.isPending ? <p className="mvp-muted">正在加载真实文档树…</p> : tree.isError ? <p role="alert" className="site-source-inline-error">文档树加载失败。<button type="button" onClick={() => void tree.refetch()}>重试</button></p> : <SiteSourceTree items={tree.data.items} rootNoteId={binding.root_note_id} source={source} resolved={saved ? sources : undefined} disabled={disabled} onChange={onSourceChange} />}
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

  return <section className="site-source-editor" aria-labelledby="site-source-title">
    <div className="site-section-heading"><div><h2 id="site-source-title">内容来源</h2><p>关联笔记本后，新文档与标题更新会在下次预览时自动出现。</p></div></div>
    <fieldset className="site-source-mode" disabled={disabled}>
      <label><input type="radio" name="site-source-kind" checked={source.kind === "notebooks"} onChange={() => setMode("notebooks")} />关联笔记本</label>
      <label><input type="radio" name="site-source-kind" checked={source.kind === "manual"} onChange={() => setMode("manual")} />手动选择</label>
    </fieldset>
    {source.kind === "manual" ? <div className="site-source-manual-note"><strong>手动选择目录</strong><p>继续使用下方站点目录。切换到笔记本来源不会删除这些手选项，切回后仍可继续编辑。</p></div> : <>
      {notebooks.isPending ? <p className="mvp-muted">正在加载笔记本…</p> : notebooks.isError ? <p role="alert" className="site-source-inline-error">无法加载笔记本。<button type="button" onClick={() => void notebooks.refetch()}>重试</button></p> : null}
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
      {!source.notebooks.length ? <div className="site-source-empty-selection"><strong>尚未关联来源</strong><p>请明确添加一个笔记本，或切换到手动选择后再保存。</p></div> : null}
      {!disabled && notebookOptions.length ? <button className="site-source-add" type="button" onClick={() => {
        const next = notebookOptions.find((item) => !source.notebooks.some((binding) => binding.notebook_id === item.id)) ?? notebookOptions[0];
        onChange({ ...source, notebooks: [...source.notebooks, { notebook_id: next.id, root_note_id: null, label: null }] });
      }}><Plus size={14} />添加来源</button> : null}
      <div className="site-source-status">
        <span>{saved ? `来源配置已保存${savedAtMs ? ` · ${formatSavedTime(savedAtMs)}` : ""}` : "来源配置尚未保存，公开路径将在保存后生成"}</span>
        {saved && sources ? <span>当前解析 {sources.pages.length} 篇 · 排除 {sources.excluded_count} 篇</span> : null}
        {saved && latestSourceUpdate ? <span>来源内容更新 · {formatSavedTime(latestSourceUpdate)}</span> : null}
        {saved && !sources ? <span>来源解析暂不可用，草稿配置仍可编辑</span> : null}
      </div>
    </>}
  </section>;
}
