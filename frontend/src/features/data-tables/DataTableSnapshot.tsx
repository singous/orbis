import { z } from "zod";
import { paginationSchema } from "../../shared/api/schemas";
import { tableRows,publicRecordSchema } from "./public-contract";
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

const UUID="[0-9a-f-]{36}";
function recordsRequest(raw:string,workspaceId:string|null|undefined){
  if(!raw.startsWith("/api/v1/")||raw.includes("%")||raw.includes("\\")||raw.includes("#"))throw new Error("表格分页地址无效");
  const url=new URL(raw,window.location.origin);
  let privateRead=false,expected:string;
  if(new RegExp(`^/api/v1/public/sites/[a-z0-9-]+/tables/${UUID}/records$`).test(url.pathname))expected="release_id";
  else if(new RegExp(`^/api/v1/public/shares/[A-Za-z0-9._-]+/documents/${UUID}/tables/${UUID}/records$`).test(url.pathname))expected="version";
  else {
    const match=new RegExp(`^/api/v1/workspaces/(${UUID})/documents/${UUID}/tables/${UUID}/public-records$`).exec(url.pathname);
    if(!match||match[1]!==workspaceId)throw new Error("预览表格不属于当前工作空间");
    privateRead=true;expected="document_version";
  }
  if(url.searchParams.getAll(expected).length!==1||[...url.searchParams.keys()].some(key=>key!==expected))throw new Error("表格分页缺少固定版本");
  return {url,privateRead};
}

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
    if (!data.records_url || !data.snapshot_id || offset === (data.offset ?? 0)) {
      setLoaded(null);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    let target:ReturnType<typeof recordsRequest>;
    try{
      if(!data.records_url||!data.fields)throw new Error("表格分页信息不完整");
      target=recordsRequest(data.records_url,auth?.workspaceId);
      target.url.searchParams.set("page",String(offset/TABLE_PAGE_SIZE+1));
      target.url.searchParams.set("page_size",String(TABLE_PAGE_SIZE));
    }catch(error){setError(error instanceof Error?error.message:"表格分页地址无效");setLoading(false);return;}
    const path=target.url.pathname.slice(4)+target.url.search;
    void apiRequest(path,{
      ...(target.privateRead&&auth?authRequestOptions(auth):{}),signal:abort.signal,
    }).then(raw=>{
      const result=z.object({title:z.string(),items:z.array(publicRecordSchema),pagination:paginationSchema}).passthrough().parse(raw);
      if(!abort.signal.aborted)setLoaded({...data,rows:tableRows(data.fields!,result.items),offset:(result.pagination.page-1)*result.pagination.page_size,total:result.pagination.total});
    }).catch(error=>{if(!abort.signal.aborted)setError(error.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return () => abort.abort();
  }, [data.snapshot_id, data.records_url, data.offset, offset, auth]);
  const rows = !data.records_url ? data.rows.slice(offset,offset+TABLE_PAGE_SIZE) : data.snapshot_id
    ? (loaded?.offset===offset?loaded.rows:offset===(data.offset??0)?data.rows:[])
    : data.rows.slice(offset, offset + TABLE_PAGE_SIZE);
  const total = data.total ?? data.rows.length;
  if(data.restricted)return <section className="data-table dt-snapshot"><header className="dt-heading"><Table2 size={18}/><strong>多维表格</strong></header><div className="dt-empty">此数据表未通过文档分享公开。<a href={`/sheets/${data.snapshot_id}`}>在拥有访问权限的工作空间中打开</a></div></section>;
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
        <span>{total} 条记录 · {data.records_url?.includes("/public/shares/")?"分享内容":data.records_url?.includes("/workspaces/")?"公开预览":"发布快照"}</span>
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
