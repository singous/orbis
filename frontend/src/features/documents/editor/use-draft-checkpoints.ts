import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckpointStatus, DraftCheckpoint } from "./draft-checkpoints";
import { createOwnedDraftCheckpoints } from "./owned-draft-checkpoints";
import { reportError } from "../../../shared/api/request-feedback";

/** Account, workspace, document and browser lane each own an isolated draft. */
export function useDraftCheckpoints(scopeKey: string) {
  const active = useRef<object | null>(null);
  const latestStatus = useRef<CheckpointStatus>({ status: "cleared", sequence: 0 });
  const reportedStorageFailure = useRef(false);
  const [, setStatus] = useState<CheckpointStatus>(latestStatus.current);
  const [candidates, setCandidates] = useState<DraftCheckpoint[]>([]);
  const [recovery, setRecovery] = useState<DraftCheckpoint | null>(null);
  const session = useMemo(() => {
    const identity = { consumers: 0 };
    const controller = createOwnedDraftCheckpoints({ scopeKey,
      onStatus: event => {
        if (active.current !== identity) return;
        const previous = latestStatus.current;
        latestStatus.current = event;
        if (event.status === "failed" && !reportedStorageFailure.current) {
          reportedStorageFailure.current = true;
          reportError(event.error ?? "浏览器暂时无法保存草稿");
        } else if (event.status === "saved" || event.status === "cleared") reportedStorageFailure.current = false;
        // Sequence changes belong to the controller. Repeated pending events
        // must not make React traverse the editing DOM on every key.
        if (previous.status !== event.status || previous.error !== event.error) setStatus(event);
      },
      onCandidates: records => { if (active.current === identity) setCandidates(records); },
    });
    return { identity, controller };
  }, [scopeKey]);
  active.current = session.identity;
  useEffect(() => {
    session.identity.consumers += 1;
    latestStatus.current = { status: "cleared", sequence: 0 };
    reportedStorageFailure.current = false;
    setStatus(latestStatus.current); setCandidates([]); setRecovery(null);
    return () => {
      session.identity.consumers -= 1;
      queueMicrotask(() => {
        // React StrictMode reconnects effects synchronously; no lock is leaked.
        if (session.identity.consumers) return;
        if (active.current === session.identity) active.current = null;
        void session.controller.dispose().catch(() => {});
      });
    };
  }, [session]);
  async function chooseRecovery(record: DraftCheckpoint) {
    await session.controller.checkpoint({ saved: record.saved, current: record.current, window: record.window, descriptors: record.descriptors,pending:record.pending??null });
    const owned = await session.controller.read();
    if (active.current === session.identity && owned) { setRecovery(owned); setCandidates([]); }
  }
  return { controller: session.controller, get status() { return latestStatus.current; }, candidates, recovery, chooseRecovery,
    consumeRecovery: () => setRecovery(null), dismissCandidates: () => setCandidates([]) };
}
