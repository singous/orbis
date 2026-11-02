import { Button } from "@orbis/ui/button";
import { ReadStatus } from "../../shared/ui/ReadStatus";
import { ApiError } from "../../shared/api/api-client";
import { LoadingState } from "../../shared/ui/LoadingState";

export function ShareStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: unknown;
  retry: () => void;
}) {
  const missing = error instanceof ApiError && error.status === 404;
  return <ReadStatus
    title={loading ? "正在打开分享…" : missing ? "分享已失效或文档不可访问" : "暂时无法打开分享"}
    pending={loading ? <LoadingState label="正在读取在线文档…" /> : undefined}
    message={missing ? "链接可能已撤销，或文档已移出分享范围。请联系文档维护者。" : error instanceof Error ? error.message : "连接失败，请稍后重试。"}
    action={<Button onClick={retry} variant="ghost">重新读取</Button>}
  />;
}
