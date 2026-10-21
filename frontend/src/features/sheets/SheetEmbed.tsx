import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ExternalLink, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { ActionButton } from "../../shared/ui/ActionButton";
import { sheetAPI } from "./api";
import { CellValue } from "./Cell";
import "./sheets.css";
export function SheetEmbed({
  id,
  viewId = "",
  onBind,
  readOnly = false,
}: {
  id?: string;
  viewId?: string;
  onBind?: (id: string, view: string) => void;
  readOnly?: boolean;
}) {
  const auth = useOptionalAuthRequest(),
    api = useMemo(() => (auth ? sheetAPI(auth) : null), [auth]);
  const [chosen, setChosen] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["sheet-embed-list", auth?.workspaceId],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => api!.list("", pageParam, signal),
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!api && !id,
  });
  const chosenMeta = useQuery({
    queryKey: ["sheets", auth?.workspaceId, chosen, "meta"],
    queryFn: ({ signal }) => api!.get(chosen, signal),
    enabled: !!api && !!chosen,
  });
  const meta = useQuery({
    queryKey: ["sheets", auth?.workspaceId, id, "meta"],
    queryFn: ({ signal }) => api!.get(id!, signal),
    enabled: !!api && !!id,
  });
  const view =
    meta.data?.definition.views.find((v) => v.id === viewId) ??
    meta.data?.definition.views[0];
  const records = useQuery({
    queryKey: [
      "sheet-embed",
      auth?.workspaceId,
      id,
      view?.id,
      meta.data?.version,
    ],
    queryFn: ({ signal }) =>
      api!.records(id!, view!.id, "", "", undefined, signal),
    enabled: !!api && !!id && !!view,
    refetchInterval: 15000,
  });
  if (!id)
    return (
      <div className="sheet-embed" contentEditable={false}>
        <header>
          <Table2 size={17} />
          <strong>引用多维表格</strong>
        </header>
        {!readOnly && onBind ? (
          <>
            <p>选择独立数据表，文档中的引用会显示同一份数据。</p>
            <select
              aria-label="选择数据表"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">请选择数据表</option>
              {list.data?.pages
                .flatMap((p) => p.items)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
            <ActionButton
              size="sm"
              variant="primary"
              className="sheet-primary"
              disabled={!chosenMeta.data}
              onClick={() =>
                onBind(chosen, chosenMeta.data!.definition.views[0].id)
              }
            >
              插入引用
            </ActionButton>
            {list.hasNextPage && (
              <ActionButton size="sm" onClick={() => void list.fetchNextPage()}>
                加载更多数据表
              </ActionButton>
            )}
            <a href="/sheets" target="_blank" rel="noreferrer">
              创建数据表
            </a>
          </>
        ) : (
          <p>尚未选择数据表</p>
        )}
      </div>
    );
  if (!auth)
    return <div className="sheet-embed">请登录工作空间查看数据表。</div>;
  const error = meta.error ?? records.error;
  return (
    <div className="sheet-embed" contentEditable={false}>
      <header>
        <Table2 size={17} />
        <strong>{meta.data?.title ?? "多维表格"}</strong>
        <a
          href={`/sheets/${id}?view=${view?.id ?? ""}`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />
          打开数据表
        </a>
      </header>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : (
        <>
          <div className="sheet-embed-scroll">
            <table>
              <thead>
                <tr>
                  {view?.field_ids.map((id) => (
                    <th key={id}>
                      {
                        meta.data?.definition.fields.find((f) => f.id === id)
                          ?.name
                      }
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.data?.items.slice(0, 20).map((row) => (
                  <tr key={row.id}>
                    {view?.field_ids.map((id) => (
                      <td key={id}>
                        <CellValue
                          field={
                            meta.data!.definition.fields.find(
                              (f) => f.id === id,
                            )!
                          }
                          value={row.values[id]}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer>
            实时引用 · 在独立工作区编辑
            {(records.data?.items.length ?? 0) > 20
              ? " · 此处预览前 20 条"
              : ""}
          </footer>
        </>
      )}
    </div>
  );
}
