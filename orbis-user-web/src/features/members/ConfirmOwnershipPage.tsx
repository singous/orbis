import { useMutation } from "@tanstack/react-query";
import { Check, Crown } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "../../shared/api/api-client";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { confirmOwnershipTransfer } from "./api";

export function ConfirmOwnershipPage() {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  const transferToken = token || searchParams.get("token") || "";
  const confirm = useMutation({ mutationFn: () => confirmOwnershipTransfer(transferToken) });
  const error = confirm.error as ApiError | null;

  return (
    <main className="grid min-h-screen place-items-center bg-[#111] p-5">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#191919] p-7 text-white shadow-2xl">
        <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-white text-black">{confirm.isSuccess ? <Check aria-hidden="true" size={20} /> : <Crown aria-hidden="true" size={20} />}</div>
        {confirm.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">所有权已完成转让</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">你现在是 Orbis 默认私人工作空间的唯一 owner。重新登录后权限将生效。</p>
            <Link to="/login"><Button className="mt-6 w-full bg-white text-black hover:bg-white/80">重新登录</Button></Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">确认接管工作空间</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">确认后，你将成为唯一 owner，原 owner 自动降级为管理员。此操作不可在本页面撤回。</p>
            {error ? <div className="mt-5"><StatusMessage tone="error" title="确认失败">{error.code === "OWNERSHIP_TRANSFER_EXPIRED" ? "确认链接已经过期，请联系当前 owner 重新发起。" : error.message}</StatusMessage></div> : null}
            <Button className="mt-6 w-full bg-white text-black hover:bg-white/80" onClick={() => confirm.mutate()} disabled={!transferToken || confirm.isPending}>确认所有权转让</Button>
            <Link to="/login" className="mt-4 block text-center text-xs text-white/45">暂不处理</Link>
          </>
        )}
      </section>
    </main>
  );
}
