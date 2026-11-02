import { Spinner } from "@orbis/ui/spinner";
import { showToast } from "../../shared/ui/Toast";
import { withRequestFeedback, reportError } from "../../shared/api/request-feedback";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Share2 } from "@orbis/ui/icons";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@orbis/ui/dialog";
import { createShare, listShares, revokeShare, type ShareTarget } from "./api";
import { Input } from "@orbis/ui/input";

export function ShareButton(target: ShareTarget) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      ><Share2 size={15} aria-hidden="true" />
        分享
      </Button>
      <ShareDialog {...target} finalFocus={trigger} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ShareDialog({
  open = true,
  onClose,
  finalFocus,
  ...target
}: ShareTarget & { open?: boolean; onClose: () => void; finalFocus?: RefObject<HTMLButtonElement | null> }) {
  const auth = useAuthRequest();
  const client = useQueryClient();
  const [created, setCreated] = useState<{ id: string; url: string } | null>(
    null,
  );
  const sessionGeneration = useRef(0);
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
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () => createShare(target, auth),
    onSuccess: (share) => {
      setCreated({
        id: share.id,
        url: new URL(share.path, window.location.origin).href,
      });

      void client.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (value:{id:string;version:number}) => withRequestFeedback({ ...auth, feedback: { success: true } }, context => revokeShare(value.id, value.version, context)),
    onSuccess: (share) => {
      if (created?.id === share.id) setCreated(null);

      void client.invalidateQueries({ queryKey: key });
    },
  });
  useEffect(() => {
    sessionGeneration.current += 1;
    if (!open) return;
    setCreated(null);

    create.reset();
    revoke.reset();
    return () => { sessionGeneration.current += 1; };
  }, [open, target.notebookId, target.noteId, auth.workspaceId]);
  async function copy(url: string) {
    const generation = sessionGeneration.current;
    try {
      await navigator.clipboard.writeText(url);
      if (generation === sessionGeneration.current) showToast({ title: "链接已复制。", tone: "success" });
    } catch {
      if (generation === sessionGeneration.current) reportError("复制失败，请手动选择并复制链接。");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (!value && (create.isPending || revoke.isPending)) { details.cancel(); return; }
        if (!value) onClose();
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
      ><DialogHeader><DialogTitle>{"分享在线文档"}</DialogTitle><DialogDescription>{`公开范围：${target.title}${target.noteId ? "及其全部下级文档" : "中的全部文档"}`}</DialogDescription></DialogHeader>
        <div data-ui="share-management" className="contents">
          <div data-theme="light" className="my-4 text-foreground rounded-[10px] border border-border bg-muted p-4 [&_p]:mt-2 [&_p]:mb-0 [&_p]:text-sm [&_p]:leading-[1.65] [&_p]:text-foreground">
            <strong>链接持有人无需登录即可阅读</strong>
            <p>
              正文与在线文档实时同步。此范围内未来新增或移入的文档也会公开；移出、归档的文档不再可读。
            </p>
            <p>分享独立于站点发布，可以随时撤销。</p>
          </div>

          {created ? (
            <div className="my-4 grid gap-[.6rem] [&_p]:mt-2 [&_p]:mb-0 [&_p]:text-sm [&_p]:leading-[1.65] [&_p]:text-foreground">
              <label className="text-sm" htmlFor="created-share-url">公开链接</label>
              <Input
                className="w-full"
                id="created-share-url"
                readOnly
                value={created.url}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                size="sm"
                onClick={() => void copy(created.url)} variant="outline"
              ><Link2 size={15} aria-hidden="true" />
                复制链接
              </Button>
              <p>可以随时重新打开分享管理复制已有链接。</p>
            </div>
          ) : null}
          <Button
            variant="default"
            onClick={() => create.mutate()} disabled={create.isPending} focusableWhenDisabled={(create.isPending)} aria-busy={create.isPending || undefined}
          >{create.isPending ? <Spinner aria-hidden="true" /> : null}
            创建公开链接
          </Button>

          <section className="mt-6" aria-label="已创建的分享链接">
            <h3 className="text-[.9rem] font-semibold">已创建的链接</h3>
            {query.isPending ? (
              <p>正在读取…</p>
            ) : !query.data?.length ? (
              <p>还没有分享链接</p>
            ) : (
              <ul className="max-h-55 list-none overflow-auto p-0">
                {query.data.map((share) => (
                  <li className="flex items-center justify-between gap-4 border-t border-border py-3" key={share.id}>
                    <div>
                      <span>{share.revoked_at_ms ? "已撤销" : "公开中"}</span>
                      <small className="mt-1 block text-(--muted-foreground)">
                        {new Date(share.created_at_ms).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </small>
                      {!share.revoked_at_ms && !share.path ? (
                        <small className="mt-1 block text-(--muted-foreground)">链接暂时无法复制，可创建新链接。</small>
                      ) : null}
                    </div>
                    {share.revoked_at_ms ? null : (
                      <div className="flex gap-2">
                        {share.path ? (
                          <Button
                            size="sm"
                            aria-label="复制链接（已有分享）"
                            onClick={() =>
                              void copy(
                                new URL(share.path!, window.location.origin).href,
                              )
                            } variant="outline"
                          >
                            复制链接
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => revoke.mutate({id:share.id,version:share.version})} disabled={revoke.isPending && revoke.variables?.id === share.id} focusableWhenDisabled={(revoke.isPending && revoke.variables?.id === share.id)} aria-busy={revoke.isPending && revoke.variables?.id === share.id || undefined}
                        >{revoke.isPending && revoke.variables?.id === share.id ? <Spinner aria-hidden="true" /> : null}
                          撤销链接
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
