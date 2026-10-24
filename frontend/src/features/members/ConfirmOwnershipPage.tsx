import { useMutation } from "@tanstack/react-query";
import { Check, Crown } from "../../shared/ui/icons";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "../../shared/api/api-client";
import { Button, buttonVariants } from "../../shared/ui/Button";
import { ToastNotification } from "../../shared/ui/Toast";
import { confirmOwnershipTransfer } from "./api";

export function ConfirmOwnershipPage() {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const transferToken = new URLSearchParams(location.hash.slice(1)).get("token") || token || searchParams.get("token") || "";
  return <OwnershipConfirmationSession key={transferToken} transferToken={transferToken} />;
}

function OwnershipConfirmationSession({ transferToken }: { transferToken: string }) {
  const confirm = useMutation({ mutationFn: () => confirmOwnershipTransfer(transferToken) });
  const error = confirm.error as ApiError | null;

  return (
    <main className="orbis-auth-layout grid min-h-screen place-items-center bg-[var(--surface-app)] p-5">
      <section className="orbis-auth-card w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-content)] p-7 text-[var(--text-primary)] shadow-2xl">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-inverse)] text-[var(--text-oninverse)]">{confirm.isSuccess ? <Check aria-hidden="true" size={20} /> : <Crown aria-hidden="true" size={20} />}</div>
        {confirm.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">所有权已完成转让</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">指定管理员已成为工作空间的唯一所有者，原所有者已降为管理员。</p>
            <Link to="/login" className={`${buttonVariants({ variant: "primary" })} mt-6 w-full`}>重新登录</Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">确认转让工作空间</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">这封确认邮件发送给当前所有者。确认后，指定管理员将成为唯一所有者，原所有者的角色降为管理员。此操作不可在本页面撤回。</p>
            {error ? <ToastNotification tone="danger" title="确认失败">{error.code === "OWNERSHIP_TRANSFER_EXPIRED" ? "确认链接已经过期，请联系当前 owner 重新发起。" : error.message}</ToastNotification> : null}
            <Button variant="primary" className="mt-6 w-full" onClick={() => confirm.mutate()} disabled={!transferToken || confirm.isPending}>确认所有权转让</Button>
            <Link to="/login" className="mt-4 block text-center text-xs text-[var(--text-secondary)]">暂不处理</Link>
          </>
        )}
      </section>
    </main>
  );
}
