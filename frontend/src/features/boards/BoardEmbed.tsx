import { reportError } from "../../shared/api/request-feedback";
import { lazy, Suspense, useContext, useEffect, useRef, useState } from "react";
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
import { ActionButton } from "../../shared/ui/ActionButton";
import { boardAPI } from "./api";
import { EmbeddedSurface } from "../../shared/ui/EmbeddedSurface";
import { BoardPreviewViewport } from "./BoardPreviewViewport";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { TableHostContext } from "../data-tables/context";
import { getNote } from "../documents/api";
import { newUUID } from "../../shared/ids";
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
    [editorLoaded, setEditorLoaded] = useState(!!props.board_id && props.board_id === blockId && props.mode !== "snapshot"),
    [editing, setEditing] = useState(!!props.board_id && props.board_id === blockId),
    [url, setURL] = useState("");
  const host = useContext(TableHostContext);
  const creating = useRef(false), mounted = useRef(true);
  const [createFailed, setCreateFailed] = useState(false);
  // UUID scopes are separate. The block owns its board, initial page and
  // creation receipt, so retrying after a remount preserves the same intent.
  const [creationID] = useState(() => blockId || newUUID());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
    refetchInterval: query => revision || query.state.status === "error" ? false : 15_000,
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
  const scope = credential + ":" + auth?.workspaceId + ":" + host?.noteId;
  const live = useRef({ scope, canEdit, onBind });
  live.current = { scope, canEdit, onBind };
  const owner = useQuery({
    queryKey: ["note", auth?.workspaceId, host?.noteId],
    queryFn: ({ signal }) => getNote(host!.noteId, auth!, signal),
    enabled: !!auth && !!host?.noteId && !id,
  });
  async function create() {
    if (!auth || !owner.data || !canEdit || !onBind || id || creating.current) return;
    creating.current = true;
    setCreateFailed(false);
    try {
      const board = await boardAPI(auth).create({
        id: creationID, operation_id: creationID, page_id: creationID,
        collection_id: owner.data.collection_id, parent_id: owner.data.id,
        title: "未命名画板", elements: [],
      });
      if (mounted.current && live.current.scope === scope && live.current.canEdit) live.current.onBind?.({ board_id: board.id, page_id: board.pages[0].id, mode: "live", revision: null, frame_id: null });
    } catch (error) {
      if (mounted.current) { setCreateFailed(true); reportError(error); }
    } finally { creating.current = false; }
  }
  useEffect(() => { if (!id && owner.data && canEdit) void create(); }, [id, owner.data, canEdit]);
  return (
    <div ref={root}>
      <EmbeddedSurface kind="board" label={meta.data?.title ?? "画板"}
        surfaceKey={`${credential}:${auth?.workspaceId}:${blockId || id}:${page}:${revision}`}
        actions={<>
          {props.mode === "snapshot" && <span className="board-reference-mode">快照 · v{revision}</span>}
          {meta.data && <Link className="board-embed-source" to={"/documents/" + meta.data.document_id + "?page=" + encodeURIComponent(page)} aria-label="打开画板"><ExternalLink size={14} /><span>打开画板</span></Link>}
          {id && page && canEdit && <ActionButton aria-pressed={editing} onPress={() => { setEditorLoaded(true); setEditing(value => !value); }}><Pencil size={14} />{editing ? "结束编辑" : "编辑画板"}</ActionButton>}
        </>}
      >
        {editorLoaded && props.mode !== "snapshot" && auth ? (
          <Suspense fallback={<div className="board-embed-start">正在打开画板…</div>}>
            <BoardEditor key={`${credential}:${auth.workspaceId}:${id}:${page}`} id={id} embed={{ pageID: page, blockID: blockId, frameID: typeof props.frame_id === "string" ? props.frame_id : undefined, readOnly: !canEdit || !editing }} />
          </Suspense>
        ) : url ? (
          <BoardPreviewViewport key={`${id}:${page}:${revision}:${String(props.frame_id ?? "")}`}><img src={url} alt={meta.data?.title ?? "画板预览"} draggable={false} /></BoardPreviewViewport>
        ) : (
          <div className="board-preview-empty">
            {query.error ? <><ActionButton onPress={() => void query.refetch()}>重试读取画板</ActionButton></> : !id ? <><Shapes size={30} />{!readOnly && (createFailed || owner.isError) && <ActionButton onPress={() => owner.isError ? void owner.refetch() : void create()}>重试创建画板</ActionButton>}<p>{readOnly ? "尚未创建画板" : createFailed || owner.isError ? "画板创建失败，请重试。" : "正在创建画板…"}</p></> : <p>{auth ? "正在读取画板预览…" : "请登录工作空间查看画板。"}</p>}
          </div>
        )}
      </EmbeddedSurface>
    </div>
  );
}
