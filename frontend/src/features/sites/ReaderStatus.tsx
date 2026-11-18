import { ReadStatus } from "../../shared/ui/ReadStatus";
import { LoadingState } from "../../shared/ui/LoadingState";
import { Button } from "@orbis/ui/button";
import { ApiError } from "../../shared/api/api-client";
import { useReaderMetadata } from "./reader/head-metadata";

export function ReaderStatus({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  useReaderMetadata(`${loading ? "正在打开文档" : missing ? "站点尚未发布或已撤回" : "暂时无法打开站点"} · Orbis`, "", undefined, true);
  return <ReadStatus
    as="main"
    appearance="reader"
    title={loading ? "正在打开文档…" : missing ? "站点尚未发布或已撤回" : "暂时无法打开站点"}
    pending={loading ? <LoadingState label="正在打开文档…" variant="editor" /> : undefined}
    message={missing ? "请确认地址，或联系站点维护者。" : error instanceof ApiError ? error.message : "连接出现问题，请稍后重试。"}
    action={<Button variant="secondary" type="button" onClick={retry}>重新加载</Button>}
  />;
}
