import { useEffect, useSyncExternalStore } from "react";
import { useBlocker } from "react-router-dom";
import { BoardDiscardDialog } from "./BoardDiscardDialog";
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

  return <BoardDiscardDialog open={blocker.state === "blocked"}
    description="离开当前页面后，未保存的修改不会恢复。可以留在当前页面重试保存，或放弃后离开。"
    cancelLabel="留在当前页" discardLabel="放弃并离开"
    onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}
    onDiscard={() => { if (blocker.state === "blocked") blocker.proceed(); }}
  />;
}
