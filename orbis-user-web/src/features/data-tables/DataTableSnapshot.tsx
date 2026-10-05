import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Table2 } from "../../shared/ui/icons";
import { apiRequest } from "../../shared/api/api-client";
import {
  authRequestOptions,
  useOptionalAuthRequest,
} from "../../shared/auth/use-auth-request";
import { TABLE_PAGE_SIZE, type TableSnapshot } from "./model";
import "../../styles/data-tables.css";

const PUBLIC_SNAPSHOT_URL =
  /^\/public\/sites\/[a-z0-9-]+\/table-snapshots\/[0-9a-f-]{36}\?expected_release_id=[0-9a-f-]{36}$/;

export function DataTableSnapshot({ data }: { data: TableSnapshot }) {
  const auth = useOptionalAuthRequest();
  const [offset, setOffset] = useState(0),
    [loaded, setLoaded] = useState<TableSnapshot | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    setOffset(0);
    setLoaded(null);
  }, [data.snapshot_id, data.revision]);
  useEffect(() => {
    if (!data.snapshot_id || offset === (data.offset ?? 0)) {
      setLoaded(null);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    let path: string;
    if (data.records_url) {
      if (!PUBLIC_SNAPSHOT_URL.test(data.records_url)) {
        setError("表格分页地址无效");
        setLoading(false);
        return;
      }
      path = `${data.records_url}&offset=${offset}&limit=${TABLE_PAGE_SIZE}`;
    } else {
      if (!auth) {
        setError("请登录后继续查看预览记录");
        setLoading(false);
        return;
      }
      path = `/table-snapshots/${data.snapshot_id}?offset=${offset}&limit=${TABLE_PAGE_SIZE}`;
    }
    void apiRequest<TableSnapshot>(path, {
      ...(data.records_url || !auth ? {} : authRequestOptions(auth)),
      signal: abort.signal,
    })
      .then(setLoaded)
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [data.snapshot_id, data.records_url, data.offset, offset, auth]);
  const rows = data.snapshot_id
    ? (loaded?.rows ?? data.rows)
    : data.rows.slice(offset, offset + TABLE_PAGE_SIZE);
  const total = data.total ?? data.rows.length;
  return (
    <section className="data-table dt-snapshot" aria-busy={loading}>
      <header className="dt-heading">
        <Table2 size={18} />
        <strong>{data.title}</strong>
        <span>{data.view}</span>
      </header>
      {error ? (
        <p role="alert" className="dt-notice">
          {error}
        </p>
      ) : null}
      <div className="dt-snapshot-scroll">
        <table>
          <thead>
            <tr>
              {data.columns.map((name, index) => (
                <th key={index} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={offset + index}>
                {row.map((value, column) => (
                  <td key={column}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="dt-footer">
        <span>{total} 条记录 · 发布快照</span>
        <div>
          <Button
            size="sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - TABLE_PAGE_SIZE))}
          >
            上一页
          </Button>
          <span>
            {offset + (rows.length ? 1 : 0)}–{offset + rows.length}
          </span>
          <Button
            size="sm"
            disabled={offset + rows.length >= total || loading}
            onClick={() => setOffset(offset + TABLE_PAGE_SIZE)}
          >
            下一页
          </Button>
        </div>
      </footer>
    </section>
  );
}
