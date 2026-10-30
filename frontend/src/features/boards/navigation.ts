import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";

type SaveSession = {
  blockId?: string;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => { pending: number };
};
const sessions = new Set<SaveSession>();
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }

// 路由只需要知道是否存在未保存修改；各编辑器仍独立持有内存操作。
export const boardNavigation = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  hasPending: () => [...sessions].some(session => session.getSnapshot().pending > 0),
  pendingBlockIds: () => new Set([...sessions].flatMap(session => session.blockId && session.getSnapshot().pending > 0 ? [session.blockId] : [])),
};

export function registerBoardNavigation(session: SaveSession) {
  sessions.add(session);
  const unsubscribe = session.subscribe(notify);
  const unregisterPreparation = registerPendingNavigation(async () => {
    if (session.getSnapshot().pending) throw new Error("画板尚未保存，请先重试保存或处理未保存的修改。");
  });
  notify();
  return () => {
    unsubscribe();
    unregisterPreparation();
    sessions.delete(session);
    notify();
  };
}
