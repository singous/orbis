import { ApiError } from "../../shared/api/api-client";
import { ActionButton } from "../../shared/ui/ActionButton";
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
  return (
    <main className="public-share-status">
      <h1>
        {loading
          ? "正在打开分享…"
          : missing
            ? "分享已失效或文档不可访问"
            : "暂时无法打开分享"}
      </h1>
      {loading ? (
        <LoadingState label="正在读取在线文档…" />
      ) : (
        <>
          <p>
            {missing
              ? "链接可能已撤销，或文档已移出分享范围。请联系文档维护者。"
              : error instanceof Error
                ? error.message
                : "连接失败，请稍后重试。"}
          </p>
          <ActionButton onClick={retry}>重新读取</ActionButton>
        </>
      )}
    </main>
  );
}
