import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { ExternalLink, Shapes } from "lucide-react";
import { Link } from "react-router-dom";
import { apiBlobRequest, workspacePath } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import {
  authRequestOptions,
  useOptionalAuthRequest,
} from "../../shared/auth/use-auth-request";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { boardAPI } from "./api";
import type { Board } from "./model";
import "./board-preview.css";
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
}: {
  props: Record<string, unknown>;
  readOnly?: boolean;
  onBind?: (binding: BoardBinding) => void;
}) {
  const auth = useOptionalAuthRequest(),
    credential = useStore(authStore, (s) => s.credentialID);
  const root = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [picker, setPicker] = useState(false),
    [expanded, setExpanded] = useState(false),
    [url, setURL] = useState("");
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
    enabled: !!auth && !!id && !!page && visible,
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
    queryKey: ["board-link", credential, auth?.workspaceId, id],
    enabled: !!auth && !!id && visible,
    queryFn: ({ signal }) => boardAPI(auth!).get(id, 0, signal),
  });
  return (
    <div ref={root} className="board-embed">
      <header>
        <Shapes size={17} />
        <strong>{meta.data?.title ?? "画板"}</strong>
        <span className="board-embed-spacer" />
        {id && url ? (
          <ActionButton onClick={() => setExpanded(true)}>
            放大查看
          </ActionButton>
        ) : null}
        {meta.data ? (
          <Link to={"/documents/" + meta.data.document_id}>
            <ExternalLink size={14} />
            打开画板
          </Link>
        ) : null}
        {!readOnly && onBind ? (
          <ActionButton onClick={() => setPicker(true)}>
            {id ? "更换引用" : "选择画板"}
          </ActionButton>
        ) : null}
      </header>
      {url ? (
        <img src={url} alt={meta.data?.title ?? "画板预览"} loading="lazy" />
      ) : (
        <div className="board-preview-empty">
          {query.error ? (
            <p role="alert">{query.error.message}</p>
          ) : !id ? (
            <>
              <Shapes size={30} />
              <p>
                {readOnly
                  ? "尚未选择画板"
                  : "选择已有画板，将内容嵌入当前文档。"}
              </p>
            </>
          ) : (
            <p>{auth ? "正在读取画板预览…" : "请登录工作空间查看画板。"}</p>
          )}
        </div>
      )}
      {expanded && url ? (
        <Dialog open onOpenChange={setExpanded}>
          <DialogContent
            title={meta.data?.title ?? "画板"}
            className="board-preview-dialog"
          >
            <div className="board-expanded-preview">
              <img src={url} alt={meta.data?.title ?? "画板"} />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {picker && auth && onBind ? (
        <BoardPicker
          onClose={() => setPicker(false)}
          onSelect={(binding) => {
            onBind(binding);
            setPicker(false);
          }}
        />
      ) : null}
    </div>
  );
}
function BoardPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (binding: BoardBinding) => void;
}) {
  const auth = useOptionalAuthRequest()!,
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Board | null>(null),
    [pageID, setPageID] = useState(""),
    [mode, setMode] = useState<"live" | "snapshot">("live"),
    [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["board-picker", auth.workspaceId, page],
    queryFn: ({ signal }) => boardAPI(auth).list(page, signal),
  });
  return (
    <Dialog
      open
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
            <label>
              页面
              <select
                aria-label="引用页面"
                value={pageID}
                onChange={(e) => setPageID(e.target.value)}
              >
                {selected.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              引用方式
              <select
                aria-label="引用方式"
                value={mode}
                onChange={(e) => setMode(e.target.value as "live" | "snapshot")}
              >
                <option value="live">实时引用</option>
                <option value="snapshot">固定快照</option>
              </select>
            </label>
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
                  frame_id: null,
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
                <button
                  key={item.id}
                  onClick={() =>
                    void boardAPI(auth)
                      .get(item.id)
                      .then((board) => {
                        setSelected(board);
                        setPageID(board.pages[0].id);
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  <Shapes size={18} />
                  <span>{item.title}</span>
                </button>
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
