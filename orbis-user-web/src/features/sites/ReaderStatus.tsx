import { ApiError } from "../../shared/api/api-client";
import { useReaderMetadata } from "./reader/head-metadata";

export function ReaderStatus({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  useReaderMetadata(`${loading ? "正在打开文档" : missing ? "站点尚未发布或已撤回" : "暂时无法打开站点"} · Orbis`, "", undefined, true);
  return <main className="site-reader-status"><h1>{loading ? "正在打开文档…" : missing ? "站点尚未发布或已撤回" : "暂时无法打开站点"}</h1>{!loading ? <><p>{missing ? "请确认地址，或联系站点维护者。" : error instanceof ApiError ? error.message : "连接出现问题，请稍后重试。"}</p><button type="button" className="mvp-button" onClick={retry}>重新加载</button></> : null}</main>;
}
