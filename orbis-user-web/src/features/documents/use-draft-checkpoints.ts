import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckpointStatus, DraftCheckpoint } from "./draft-checkpoints";
import { createOwnedDraftCheckpoints } from "./owned-draft-checkpoints";

/** Account, workspace, document and browser lane each own an isolated draft. */
export function useDraftCheckpoints(scopeKey: string) {
  const active = useRef<object | null>(null);
  const [status, setStatus] = useState<CheckpointStatus>({ status: "cleared", sequence: 0 });
  const [candidates, setCandidates] = useState<DraftCheckpoint[]>([]);
  const [recovery, setRecovery] = useState<DraftCheckpoint | null>(null);
  const session = useMemo(() => {
    const identity = { consumers: 0 };
    const controller = createOwnedDraftCheckpoints({ scopeKey,
      onStatus: event => { if (active.current === identity) setStatus(event); },
      onCandidates: records => { if (active.current === identity) setCandidates(records); },
    });
    return { identity, controller };
  }, [scopeKey]);
  active.current = session.identity;
  useEffect(() => {
    session.identity.consumers += 1;
    setStatus({ status: "cleared", sequence: 0 }); setCandidates([]); setRecovery(null);
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
    await session.controller.checkpoint({ saved: record.saved, current: record.current, window: record.window, descriptors: record.descriptors });
    const owned = await session.controller.read();
    if (active.current === session.identity && owned) { setRecovery(owned); setCandidates([]); }
  }
  return { controller: session.controller, status, candidates, recovery, chooseRecovery,
    consumeRecovery: () => setRecovery(null), dismissCandidates: () => setCandidates([]) };
}
