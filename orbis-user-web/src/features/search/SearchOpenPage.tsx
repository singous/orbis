import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useStore } from "zustand";
import { apiBlobRequest } from "../../shared/api/api-client";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { authRequestOptions, useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { LoadingState } from "../../shared/ui/LoadingState";
import { PageContainer } from "../../shared/ui/PageContainer";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { searchTypeSchema, switchSearchWorkspace } from "./api";
import { resultDestination } from "./search-state";
import "./search.css";

const openTargetSchema = z.object({
  id: z.string().uuid(), type: searchTypeSchema, workspace_id: z.string().uuid(),
  status: z.enum(["active", "archived"]).default("active"), comment: z.string().uuid().nullable(),
});
const DOWNLOAD_URL_LIFETIME_MS = 1_000;

/** A real route preserves new-tab links and switches only after explicit opening. */
export function SearchOpenPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuthRequest();
  const authRef = useRef(auth);
  authRef.current = auth;
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const downloadRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const targetKey = params.toString();
  const target = useMemo(() => {
    const values = new URLSearchParams(targetKey);
    return openTargetSchema.safeParse({ id: values.get("id"), type: values.get("type"), workspace_id: values.get("workspace_id"), status: values.get("status") ?? "active", comment: values.get("comment") });
  }, [targetKey]);
  const filename = (params.get("name") || "文件").slice(0, 512);

  useEffect(() => {
    if (!target.success) return;
    let active = true;
    const controller = new AbortController();
    setError(null);
    setReady(false);
    setDownloaded(false);
    setDownloading(false);
    const destination = target.data;
    const initialSession = getAuthSessionKey(authStore.getState());
    void (async () => {
      if (authStore.getState().workspace?.id !== destination.workspace_id) {
        const switched = await switchSearchWorkspace(destination.workspace_id, authRef.current, controller.signal);
        const current = authStore.getState();
        if (!active || getAuthSessionKey(current) !== initialSession || !current.accessToken || !current.refreshToken) return;
        authStore.getState().setSession({ accessToken: current.accessToken, refreshToken: current.refreshToken, ...switched });
      }
      if (active) {
        if (destination.type === "file") setReady(true);
        else navigate(resultDestination({ ...destination, matched_comment_id: destination.comment }), { replace: true });
      }
    })().catch((cause: unknown) => { if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法打开搜索结果，请返回重试。"); });
    return () => { active = false; controller.abort(); downloadRequest.current?.abort(); };
  }, [sessionKey, navigate, target]);

  async function download() {
    if (!target.success || downloading) return;
    setDownloading(true);
    setError(null);
    const controller = new AbortController();
    downloadRequest.current = controller;
    const initialSession = getAuthSessionKey(authStore.getState());
    try {
      const blob = await apiBlobRequest(`/files/${target.data.id}/content`, { ...authRequestOptions(auth), signal: controller.signal });
      if (controller.signal.aborted || getAuthSessionKey(authStore.getState()) !== initialSession) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
      setDownloaded(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "文件下载失败，请重试。");
    } finally { if (!controller.signal.aborted) setDownloading(false); }
  }

  return <WorkspaceShell><PageContainer title={target.success && target.data.type === "file" ? filename : "打开搜索结果"}>
    <div className="global-search-open">
      {!target.success ? <StatusMessage tone="error" title="搜索结果地址无效">请返回搜索页重新选择结果。</StatusMessage> : null}
      {error ? <StatusMessage tone="error" title="无法打开内容">{error}</StatusMessage> : null}
      {target.success && !ready && !error ? <LoadingState label="正在校验工作空间并打开内容…" /> : null}
      {ready ? <><p>文件内容仅在下载时读取。</p><Button variant="primary" isPending={downloading} onClick={() => void download()}>下载文件</Button>{downloaded ? <p role="status">已开始下载。</p> : null}</> : null}
      <Link to="/search">返回全局搜索</Link>
    </div>
  </PageContainer></WorkspaceShell>;
}
