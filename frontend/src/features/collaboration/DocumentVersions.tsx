import { reportError } from "../../shared/api/request-feedback";
import { useRef, useState, type FormEvent } from "react";
import { TextArea } from "@heroui/react/textarea";
import { ApiError } from "../../shared/api/api-client";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Button } from "../../shared/ui/Button";
import { TextInput } from "../../shared/ui/TextInput";
import { SelectField } from "../../shared/ui/SelectField";
import { LoadingState } from "../../shared/ui/LoadingState";
import { documentVersionLabel, type DocumentVersion, type SaveVersionInput } from "./version-api";
import { useDocumentVersion, useDocumentVersionComparison, useDocumentVersions, useEditDocumentVersion, useRestoreDocumentVersion, useSaveDocumentVersion } from "./version-queries";
import { RevisionContent } from "./RevisionContent";
import type { RestoreSavedRevision } from "./DocumentCollaborationPanel";

const formatTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });

const uncertain = (error: unknown) => error instanceof ApiError && error.code === "DOCUMENT_WRITE_RESULT_UNKNOWN";

type Props = {
  noteId: string;
  canManage: boolean;
  onPrepare?: () => Promise<number>;
  onRestore: (restore: RestoreSavedRevision) => Promise<void>;
  onBusyChange: (value: boolean) => void;
  onLegacy: () => void;
};

function VersionMetadata({ version, noteId, onBusyChange }: { version: DocumentVersion; noteId: string; onBusyChange: Props["onBusyChange"] }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(version.name ?? "");
  const [description, setDescription] = useState(version.description);
  const [baseVersion, setBaseVersion] = useState(version.metadata_version);
  const update = useEditDocumentVersion(noteId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    onBusyChange(true);
    try {
      await update.mutateAsync({ id: version.id, name: name.trim() || null, description, expected_metadata_version: baseVersion });
      setEditing(false);

    } catch { /* The mutation exposes the actionable error without discarding input. */ }
    finally { onBusyChange(false); }
  }
  if (!editing) return <Button type="button" variant="secondary" onClick={() => { setName(version.name ?? ""); setDescription(version.description); setBaseVersion(version.metadata_version); setEditing(true); }}>编辑名称与说明</Button>;
  return <form className="collaboration-form" onSubmit={submit}>
    <TextInput label="版本名称" value={name} maxLength={120} disabled={update.isPending || uncertain(update.error)} onChange={event => setName(event.target.value)} />
    <label><span>版本说明</span><TextArea value={description} maxLength={2000} disabled={update.isPending || uncertain(update.error)} onChange={event => setDescription(event.target.value)} /></label>

    <div className="collaboration-actions"><Button type="submit" variant="primary" disabled={update.isPending}>{update.isPending ? "正在更新…" : uncertain(update.error) ? "重试更新信息" : "更新版本信息"}</Button><Button type="button" variant="secondary" disabled={update.isPending || uncertain(update.error)} onClick={() => setEditing(false)}>取消</Button></div>
  </form>;
}

function VersionComparison({ noteId, from, to }: { noteId: string; from: string; to: string }) {
  const comparison = useDocumentVersionComparison(noteId, from, to);
  const result = comparison.data?.pages[0];
  const labels = { added: "新增", removed: "删除", modified: "修改", moved: "移动" };
  return <section className="collaboration-version-diff" aria-label="版本差异">
    <h4>内容差异</h4>
    {comparison.isPending ? <LoadingState label="正在比较版本…" compact /> : null}

    {comparison.isError ? <Button type="button" variant="secondary" onClick={() => void comparison.refetch()}>重试比较版本</Button> : null}
    {result && result.from.title !== result.to.title ? <p>标题：<del>{result.from.title}</del> → <ins>{result.to.title}</ins></p> : null}
    {result && result.items.length === 0 ? <p className="collaboration-hint">正文内容与结构相同。</p> : null}
    {comparison.data?.pages.flatMap(page => page.items).map(item => <article className="collaboration-diff-item" key={item.block_id}>
      <strong>{labels[item.change]}{item.change === "modified" && item.position_changed ? "并移动" : ""}</strong>
      {item.content_changed ? <><div><span className="collaboration-diff-label">之前</span><p>{item.before_text || "（无文本内容）"}</p></div><div><span className="collaboration-diff-label">之后</span><p>{item.after_text || "（无文本内容）"}</p></div></> : <p className="collaboration-hint">块的位置或层级发生变化。</p>}
    </article>)}
    {comparison.hasNextPage ? <Button type="button" variant="secondary" disabled={comparison.isFetchingNextPage} onClick={() => void comparison.fetchNextPage()}>加载更多差异</Button> : null}
    {result ? <p className="collaboration-hint">文本显示摘要；完整内容可在版本预览中查看。共享表格和外部链接的内容由来源管理。</p> : null}
  </section>;
}

export function DocumentVersions({ noteId, canManage, onPrepare, onRestore, onBusyChange, onLegacy }: Props) {
  const list = useDocumentVersions(noteId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareFrom, setCompareFrom] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);

  const pendingSave = useRef<SaveVersionInput | null>(null);
  const pendingRestore = useRef<{ id: string; expected_revision: number } | null>(null);
  const save = useSaveDocumentVersion(noteId);
  const restore = useRestoreDocumentVersion(noteId);
  const detail = useDocumentVersion(noteId, selectedId);
  const versions = list.data?.pages.flatMap(page => page.items) ?? [];
  const busy = preparing || save.isPending || restore.isPending || metadataBusy;
  const saveUncertain = uncertain(save.error);
  const restoreUncertain = uncertain(restore.error);

  async function saveVersion(event: FormEvent) {
    event.preventDefault();
    if (!onPrepare || busy) return;
    setPreparing(true); onBusyChange(true);
    try {
      pendingSave.current ??= { name: name.trim(), description, source_revision: await onPrepare() };
      const version = await save.mutateAsync(pendingSave.current);
      pendingSave.current = null; setName(""); setDescription(""); setSelectedId(version.id); setCreating(false);

    } catch (cause) {
      if (!uncertain(cause)) pendingSave.current = null;
      reportError(cause);
    } finally { setPreparing(false); onBusyChange(false); }
  }
  async function restoreSelected() {
    if (!selectedId || busy) return;
    onBusyChange(true);
    try {
      await onRestore(expected => {
        pendingRestore.current ??= { id: selectedId, expected_revision: expected };
        return restore.mutateAsync(pendingRestore.current);
      });
      pendingRestore.current = null;

    } catch (cause) {   if (!uncertain(cause)) pendingRestore.current = null; reportError(cause); }
    finally { onBusyChange(false); }
  }

  return <section aria-label="文档版本管理" className="collaboration-section document-versions">
    <p className="collaboration-hint">自动历史按编辑活动汇总。命名版本会固定已保存的内容，便于评审、比较和恢复。</p>
    {list.isSuccess && !list.data.pages[0].automatic_history_enabled ? <p className="collaboration-hint">自动历史未启用，可以手动保存命名版本。</p> : null}
    {!canManage ? <p className="collaboration-hint">只读成员可以查看历史，保存和恢复版本需要编辑权限。</p> : null}
    {canManage && onPrepare && !creating ? <Button type="button" variant="primary" disabled={busy || restoreUncertain} onClick={() => setCreating(true)}>新建命名版本</Button> : null}
    {canManage && onPrepare && creating ? <form className="collaboration-form collaboration-version-save" onSubmit={saveVersion}>
      <TextInput label="新版本名称" placeholder="例如：评审稿" value={name} maxLength={120} required disabled={busy || saveUncertain || restoreUncertain} onChange={event => setName(event.target.value)} />
      <label><span>版本说明（可选）</span><TextArea value={description} maxLength={2000} disabled={busy || saveUncertain} onChange={event => setDescription(event.target.value)} /></label>
      <Button type="submit" variant="primary" disabled={busy || restoreUncertain || !name.trim()}>{busy ? "正在保存版本…" : saveUncertain ? "重试保存版本" : "保存命名版本"}</Button>
      <Button type="button" variant="secondary" disabled={busy || saveUncertain} onClick={() => setCreating(false)}>取消新建版本</Button>
    </form> : null}

    {list.isPending ? <LoadingState label="正在加载版本…" compact /> : null}

    {list.isError ? <Button type="button" variant="secondary" onClick={() => void list.refetch()}>重试加载版本</Button> : null}
    {list.isSuccess && versions.length === 0 ? <p className="collaboration-empty">暂无版本。可以保存命名版本，或在停笔后查看自动历史。</p> : null}
    <div className="collaboration-revisions">{versions.map(version => <ActionButton type="button" className="collaboration-revision" key={version.id} aria-label={`查看版本 ${documentVersionLabel(version)}`} aria-pressed={selectedId === version.id} disabled={busy || saveUncertain || restoreUncertain} onClick={() => { setSelectedId(version.id); setCompareFrom("");  }}>
      <span>{documentVersionLabel(version)}</span><small>{version.author_name || "历史作者"} · {formatTime.format(version.captured_at_ms)}</small>
      {version.description ? <small>{version.description}</small> : null}
    </ActionButton>)}</div>
    {list.hasNextPage ? <Button type="button" variant="secondary" disabled={busy || list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>加载更多版本</Button> : null}
    {selectedId ? <div className="collaboration-preview">
      {detail.isPending ? <LoadingState label="正在加载版本正文…" compact /> : null}

      {detail.isError ? <Button type="button" variant="secondary" onClick={() => void detail.refetch()}>重试加载正文</Button> : null}
      {detail.data ? <>
        <h3>{documentVersionLabel(detail.data.version)}</h3>
        <p className="collaboration-hint">内容保存于 {formatTime.format(detail.data.version.captured_at_ms)}</p>
        {detail.data.dependencies.some(dep => dep.kind === "sheet_link") ? <p className="collaboration-hint">此文档包含共享表格链接。预览显示来源当前可见的数据；恢复只恢复链接，表格数据由来源独立管理。</p> : null}
        {canManage && !saveUncertain && !restoreUncertain ? <VersionMetadata key={selectedId} noteId={noteId} version={detail.data.version} onBusyChange={value => { setMetadataBusy(value); onBusyChange(value); }} /> : null}
        <RevisionContent noteId={noteId} version={detail.data.version.source_revision} blocks={detail.data.blocks} />
        {versions.some(version => version.id !== selectedId) ? <SelectField label="选择比较起点" value={compareFrom} options={[{ value: "", label: "选择另一个版本" }, ...versions.filter(version => version.id !== selectedId).map(version => ({ value: version.id, label: `${documentVersionLabel(version)} · ${formatTime.format(version.captured_at_ms)}` }))]} disabled={busy} onChange={setCompareFrom} /> : null}
        {compareFrom ? <VersionComparison noteId={noteId} from={compareFrom} to={selectedId} /> : null}
        {canManage ? <div className="collaboration-restore"><p className="collaboration-hint">恢复会先保存当前草稿，再生成新的编辑状态。恢复前的内容会保留在历史中。</p><Button type="button" variant="primary" disabled={busy} onClick={restoreSelected}>{restore.isPending ? "正在恢复…" : "恢复此版本"}</Button></div> : null}
      </> : null}
    </div> : null}
    <Button type="button" variant="secondary" disabled={busy || saveUncertain || restoreUncertain} onClick={onLegacy}>查看全部保存记录</Button>
  </section>;
}
