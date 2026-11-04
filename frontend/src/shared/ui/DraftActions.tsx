import type { ReactNode } from "react";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@orbis/ui/dialog";
import { History } from "./icons";

/** 用户主动打开的草稿工具，不通过通知要求用户处理。 */
export function DraftActions({ children, label = "本机修改" }: { children: ReactNode; label?: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="ghost" aria-label={label} title={label} />}>
        <History size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
        <div className="grid gap-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
