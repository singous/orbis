import { useEffect, useSyncExternalStore } from "react";
import { useBlocker } from "react-router-dom";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { boardNavigation } from "./navigation";

/** 一个工作空间路由只有一个 blocker，统一覆盖多个画板及普通 Link、返回和程序跳转。 */
export function BoardNavigationGuard() {
  const pending = useSyncExternalStore(boardNavigation.subscribe, boardNavigation.hasPending);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    boardNavigation.hasPending() && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!pending && blocker.state === "blocked") blocker.proceed();
  }, [pending, blocker]);

  return <Dialog open={blocker.state === "blocked"} onOpenChange={open => {
    if (!open && blocker.state === "blocked") blocker.reset();
  }}>
    <DialogContent title="画板尚未保存">
      <p>离开当前页面后，未保存的修改不会恢复。可以留在当前页面重试保存，或放弃后离开。</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={() => { if (blocker.state === "blocked") blocker.reset(); }}>留在当前页</Button>
        <Button variant="danger" onClick={() => { if (blocker.state === "blocked") blocker.proceed(); }}>放弃并离开</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
