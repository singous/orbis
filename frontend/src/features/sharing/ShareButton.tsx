import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Share2 } from "lucide-react";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { createShare, listShares, revokeShare, type ShareTarget } from "./api";
import "../../styles/document-sharing.css";

export function ShareButton(target: ShareTarget) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<Share2 size={15} aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        分享
      </Button>
      {open ? <ShareDialog {...target} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ShareDialog({
  onClose,
  ...target
}: ShareTarget & { onClose: () => void }) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  const [created, setCreated] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const key = [
    "document-shares",
    auth.workspaceId,
    target.notebookId,
    target.noteId ?? null,
  ];
  const query = useQuery({
    queryKey: key,
    queryFn: () => listShares(target, auth),
    retry: false,
    staleTime: 0,
  });
  const create = useMutation({
    mutationFn: () => createShare(target, auth),
    onSuccess: (share) => {
      setCreated({
        id: share.id,
        url: new URL(share.path, window.location.origin).href,
      });
      setFeedback(null);
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (value:{id:string;version:number}) => revokeShare(value.id,value.version,auth),
    onSuccess: (share) => {
      if (created?.id === share.id) setCreated(null);
      setFeedback("链接已撤销，后续访问立即失效。");
      void client.invalidateQueries({ queryKey: key });
    },
  });
  useEffect(() => {
    setCreated(null);
    setFeedback(null);
  }, [target.notebookId, target.noteId, auth.workspaceId]);
  const error = create.error ?? revoke.error ?? query.error;
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setFeedback("链接已复制。");
    } catch {
      setFeedback("复制失败，请手动选择并复制链接。");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        title="分享在线文档"
        description={`公开范围：${target.title}${target.noteId ? "及其全部下级文档" : "中的全部文档"}`}
      >
        <div className="share-disclosure">
          <strong>链接持有人无需登录即可阅读</strong>
          <p>
            正文与在线文档实时同步。此范围内未来新增或移入的文档也会公开；移出、归档的文档不再可读。
          </p>
          <p>分享独立于站点发布，可以随时撤销。</p>
        </div>
        {error ? (
          <p role="alert">
            {error instanceof Error ? error.message : "分享操作失败，请重试。"}
          </p>
        ) : null}
        {created ? (
          <div className="share-created">
            <label htmlFor="created-share-url">公开链接</label>
            <input
              id="created-share-url"
              readOnly
              value={created.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              size="sm"
              icon={<Link2 size={15} aria-hidden="true" />}
              onClick={() => void copy(created.url)}
            >
              复制链接
            </Button>
            <p>可以随时重新打开分享管理复制已有链接。</p>
          </div>
        ) : null}
        <Button
          variant="primary"
          isPending={create.isPending}
          onClick={() => create.mutate()}
        >
          创建公开链接
        </Button>
        {feedback ? <p role="status">{feedback}</p> : null}
        <section className="share-existing" aria-label="已创建的分享链接">
          <h3>已创建的链接</h3>
          {query.isPending ? (
            <p>正在读取…</p>
          ) : !query.data?.length ? (
            <p>还没有分享链接</p>
          ) : (
            <ul>
              {query.data.map((share) => (
                <li key={share.id}>
                  <div>
                    <span>{share.revoked_at_ms ? "已撤销" : "公开中"}</span>
                    <small>
                      {new Date(share.created_at_ms).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                    </small>
                    {!share.revoked_at_ms && !share.path ? (
                      <small>链接暂时无法复制，可创建新链接。</small>
                    ) : null}
                  </div>
                  {share.revoked_at_ms ? null : (
                    <div className="share-link-actions">
                      {share.path ? (
                        <Button
                          size="sm"
                          aria-label="复制已有分享链接"
                          onClick={() =>
                            void copy(
                              new URL(share.path!, window.location.origin).href,
                            )
                          }
                        >
                          复制链接
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="danger"
                        isPending={
                          revoke.isPending && revoke.variables?.id === share.id
                        }
                        onClick={() => revoke.mutate({id:share.id,version:share.version})}
                      >
                        撤销链接
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
