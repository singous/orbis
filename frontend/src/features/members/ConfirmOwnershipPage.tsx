import { memberEntryStyles } from "./member-entry-styles";
import { useMutation } from "@tanstack/react-query";
import { Check, Crown } from "../../shared/ui/icons";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";

import { Button, buttonVariants } from "@orbis/ui/button";

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

  return (
    <main className={memberEntryStyles.layout}>
      <section className={memberEntryStyles.card}>
        <div className={memberEntryStyles.icon}>{confirm.isSuccess ? <Check aria-hidden="true" size={20} /> : <Crown aria-hidden="true" size={20} />}</div>
        {confirm.isSuccess ? (
          <>
            <h1 className={memberEntryStyles.heading}>所有权已完成转让</h1>
            <p className={memberEntryStyles.description}>指定管理员已成为工作空间的唯一所有者，原所有者已降为管理员。</p>
            <Link to="/login" className={`${buttonVariants({ variant: "default" })} mt-6 w-full`}>重新登录</Link>
          </>
        ) : (
          <>
            <h1 className={memberEntryStyles.heading}>确认转让工作空间</h1>
            <p className={memberEntryStyles.description}>这封确认邮件发送给当前所有者。确认后，指定管理员将成为唯一所有者，原所有者的角色降为管理员。此操作不可在本页面撤回。</p>

            <Button variant="default" className="mt-6 w-full" onClick={() => confirm.mutate()} disabled={!transferToken || confirm.isPending}>确认所有权转让</Button>
            <Link to="/login" className="mt-4 block text-center text-xs text-(--muted-foreground)">暂不处理</Link>
          </>
        )}
      </section>
    </main>
  );
}
