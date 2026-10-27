import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ExternalLink, Pencil, Shapes } from "lucide-react";
import { Link } from "react-router-dom";
import { apiBlobRequest, workspacePath } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import {
  authRequestOptions,
  useOptionalAuthRequest,
} from "../../shared/auth/use-auth-request";
import { SelectField } from "../../shared/ui/SelectField";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { boardAPI } from "./api";
import { SHAPES, type Board, type Element } from "./model";
import { EmbeddedSurface } from "../../shared/ui/EmbeddedSurface";
import { BoardPreviewViewport } from "./BoardPreviewViewport";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import type { BoardSession } from "./session";
import "./board-preview.css";
const BoardEditor = lazy(() => import("./BoardEditor").then(module => ({ default: module.BoardEditor })));
export type BoardBinding = {
  board_id: string | null;
  page_id: string | null;
  mode: "live" | "snapshot";
  revision: number | null;
  frame_id: string | null;
};
export function BoardEmbed({
  props,
  readOnly = true,
  onBind,
  blockId = "",
}: {
  props: Record<string, unknown>;
  blockId?: string;
  readOnly?: boolean;
  onBind?: (binding: BoardBinding) => void;
}) {
  const auth = useOptionalAuthRequest(),
    credential = useStore(authStore, (s) => s.credentialID);
  const root = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [picker, setPicker] = useState(false),
    [pickerSession, setPickerSession] = useState(0),
    [editorLoaded, setEditorLoaded] = useState(false),
    [editing, setEditing] = useState(false),
    [replacement, setReplacement] = useState<BoardBinding | null>(null),
    [url, setURL] = useState("");
  const session = useRef<Pick<BoardSession, "getSnapshot"> | null>(null);
  const id = typeof props.board_id === "string" ? props.board_id : "",
    page = typeof props.page_id === "string" ? props.page_id : "",
    revision = props.mode === "snapshot" ? Number(props.revision) : 0;
  useEffect(() => {
    if (!root.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const query = useQuery({
    queryKey: [
      "board-preview",
      credential,
      auth?.workspaceId,
      id,
      page,
      revision,
      props.frame_id,
    ],
    enabled: !!auth && !!id && !!page && visible && !editorLoaded,
    queryFn: ({ signal }) =>
      apiBlobRequest(
        workspacePath(
          auth!,
          `/boards/${id}/preview?` +
            new URLSearchParams({
              page_id: page,
              revision: String(revision),
              ...(typeof props.frame_id === "string"
                ? { frame_id: props.frame_id }
                : {}),
            }),
        ),
        { ...authRequestOptions(auth!), signal },
      ),
    staleTime: 10_000,
    refetchInterval: revision ? false : 15_000,
    retry: false,
  });
  useEffect(() => {
    if (!query.data) {
      setURL("");
      return;
    }
    const value = URL.createObjectURL(query.data);
    setURL(value);
    return () => URL.revokeObjectURL(value);
  }, [query.data]);
  const meta = useQuery({
    queryKey: ["board-link", credential, auth?.workspaceId, id, revision],
    enabled: !!auth && !!id && visible,
    queryFn: ({ signal }) => boardAPI(auth!).get(id, revision, signal),
  });
  const workspace = useStore(authStore, state => state.workspace);
  const canEdit = !readOnly && props.mode !== "snapshot" && canMutateWorkspaceContent(workspace);
  function bind(binding: BoardBinding) {
    onBind?.(binding);
    setEditing(false);
    setEditorLoaded(false);
    setReplacement(null);
    setPicker(false);
  }
  return (
    <div ref={root}>
      <EmbeddedSurface kind="board" label={meta.data?.title ?? "画板"}
        surfaceKey={`${credential}:${auth?.workspaceId}:${blockId || id}:${page}:${revision}`}
        actions={<>
          <span className="board-reference-mode">{props.mode === "snapshot" ? `快照 · v${revision}` : "实时引用"}</span>
          {meta.data && <Link className="board-embed-source" to={"/documents/" + meta.data.document_id + "?page=" + encodeURIComponent(page)} aria-label="打开画板"><ExternalLink size={14} /><span>源画板</span></Link>}
          {id && page && canEdit && <ActionButton aria-pressed={editing} onPress={() => { setEditorLoaded(true); setEditing(value => !value); }}><Pencil size={14} />{editing ? "结束编辑" : "编辑画板"}</ActionButton>}
          {!readOnly && onBind && <ActionButton onPress={() => { setPickerSession(value => value + 1); setPicker(true); }}>{id ? "更换引用" : "选择画板"}</ActionButton>}
        </>}
      >
        {editorLoaded && props.mode !== "snapshot" && auth ? (
          <Suspense fallback={<div className="board-embed-start">正在打开画板…</div>}>
            <BoardEditor key={`${credential}:${auth.workspaceId}:${id}:${page}`} id={id} embed={{ pageID: page, frameID: typeof props.frame_id === "string" ? props.frame_id : undefined, readOnly: !canEdit || !editing, sessionRef: session }} />
          </Suspense>
        ) : url ? (
          <BoardPreviewViewport key={`${id}:${page}:${revision}:${String(props.frame_id ?? "")}`}><img src={url} alt={meta.data?.title ?? "画板预览"} draggable={false} /></BoardPreviewViewport>
        ) : (
          <div className="board-preview-empty">
            {query.error ? <><p role="alert">{query.error.message}</p><ActionButton onPress={() => void query.refetch()}>重试读取画板</ActionButton></> : !id ? <><Shapes size={30} /><p>{readOnly ? "尚未选择画板" : "选择已有画板，将内容嵌入当前文档。"}</p></> : <p>{auth ? "正在读取画板预览…" : "请登录工作空间查看画板。"}</p>}
          </div>
        )}
      </EmbeddedSurface>
      {auth && onBind ? (
        <BoardPicker
          key={pickerSession}
          open={picker}
          onClose={() => setPicker(false)}
          onSelect={(binding) => {
            if (session.current?.getSnapshot().pending) {
              setPicker(false);
              setReplacement(binding);
            } else bind(binding);
          }}
        />
      ) : null}
      <Dialog open={replacement !== null} onOpenChange={open => { if (!open) setReplacement(null); }}>
        <DialogContent title="画板尚未保存">
          <p>更换引用后，当前画板未保存的修改不会恢复。可以保留当前画板重试保存，或放弃修改后更换。</p>
          <div className="mt-4 flex justify-end gap-2">
            <ActionButton onPress={() => setReplacement(null)}>保留当前画板</ActionButton>
            <ActionButton variant="danger" disabled={readOnly || !onBind} onPress={() => { if (replacement) bind(replacement); }}>放弃并更换</ActionButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function BoardPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (binding: BoardBinding) => void;
}) {
  const auth = useOptionalAuthRequest()!,
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Board | null>(null),
    [pageID, setPageID] = useState(""),
    [frameID, setFrameID] = useState(""),
    [mode, setMode] = useState<"live" | "snapshot">("live"),
    [error, setError] = useState(""),
    [selecting, setSelecting] = useState<string | null>(null);
  const selectionGeneration = useRef(0);
  const selectionAbort = useRef<AbortController | null>(null);
  useEffect(() => () => {
    selectionGeneration.current++;
    selectionAbort.current?.abort();
  }, [open]);
  const query = useQuery({
    queryKey: ["board-picker", auth.workspaceId, page],
    enabled: open,
    queryFn: ({ signal }) => boardAPI(auth).list(page, signal),
  });
  const frames = useQuery({
    queryKey: ["board-picker-frames", auth.workspaceId, selected?.id, selected?.revision, pageID],
    enabled: open && !!selected && !!pageID,
    queryFn: async ({ signal }) => {
      const values: Element[] = [];
      let cursor = "";
      do {
        const result = await boardAPI(auth).elements(selected!.id, pageID, selected!.revision, cursor, signal);
        values.push(...result.items.filter(element => SHAPES.get(element.shape_type)?.primitive === "frame"));
        cursor = result.has_more ? result.next_cursor ?? "" : "";
      } while (cursor);
      return values;
    },
  });
  async function selectBoard(id: string) {
    const generation = ++selectionGeneration.current;
    selectionAbort.current?.abort();
    const abort = new AbortController();
    selectionAbort.current = abort;
    setSelecting(id);
    setError("");
    try {
      const board = await boardAPI(auth).get(id, 0, abort.signal);
      if (abort.signal.aborted || generation !== selectionGeneration.current) return;
      if (!board.pages[0]) throw new Error("画板没有可引用的页面，请选择其他画板。");
      setSelected(board);
      setFrameID("");
      setPageID(board.pages[0].id);
    } catch (error) {
      if (!abort.signal.aborted && generation === selectionGeneration.current)
        setError(error instanceof Error ? error.message : "画板读取失败，请重试。");
    } finally {
      if (!abort.signal.aborted && generation === selectionGeneration.current)
        setSelecting(null);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="插入画板引用"
        description="画板内容保持独立。实时引用会随原画板更新，固定快照保留当前版本。"
      >
        {error || query.error ? (
          <p role="alert">{error || query.error?.message}</p>
        ) : null}
        {selected ? (
          <div className="board-picker-settings">
            <strong>{selected.title}</strong>
            <SelectField label="引用页面" value={pageID} onChange={value => { setFrameID(""); setPageID(value); }}
              options={selected.pages.map(p => ({ value: p.id, label: p.name }))} />
            <SelectField label="引用方式" value={mode} onChange={value => setMode(value === "snapshot" ? "snapshot" : "live")}
              options={[{ value: "live", label: "实时引用" }, { value: "snapshot", label: "固定快照" }]} />
            <SelectField label="展示范围" value={frameID} onChange={setFrameID}
              options={[{ value: "", label: "整页画板" }, ...(frames.data ?? []).map(frame => ({ value: frame.id, label: frame.text || "未命名画框" }))]} />
            {frames.isFetching && <p role="status">正在读取可选画框…</p>}
            {frames.error && <p role="alert">画框读取失败：{frames.error.message} <ActionButton onPress={() => void frames.refetch()}>重试</ActionButton></p>}
            <ActionButton onClick={() => setSelected(null)}>
              重新选择
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={() =>
                onSelect({
                  board_id: selected.id,
                  page_id: pageID,
                  mode,
                  revision: mode === "snapshot" ? selected.revision : null,
                  frame_id: frameID || null,
                })
              }
            >
              插入画板
            </ActionButton>
          </div>
        ) : (
          <>
            <div className="board-picker-list">
              {query.data?.items.map((item) => (
                <ActionButton
                  key={item.id}
                  aria-busy={selecting === item.id}
                  onClick={() => void selectBoard(item.id)}
                >
                  <Shapes size={18} />
                  <span>{item.title}</span>
                </ActionButton>
              ))}
              {query.data && !query.data.items.length ? (
                <p>工作空间还没有画板。可以先在文集目录中新建画板。</p>
              ) : null}
            </div>
            <div className="board-picker-pagination">
              <ActionButton
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </ActionButton>
              <span>第 {page} 页</span>
              <ActionButton
                disabled={
                  !query.data ||
                  page * query.data.pagination.page_size >=
                    query.data.pagination.total
                }
                onClick={() => setPage(page + 1)}
              >
                下一页
              </ActionButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
