import { Profiler, useState } from "react";
import { createRoot } from "react-dom/client";
import { TiptapEditor } from "../../../src/features/notes/TiptapEditor";
import { AutosaveCoordinator } from "../../../src/features/documents/autosave";
import type { NoteBlocksV2, OrbisBlock } from "../../../src/features/notes/block-model";
import { createEditorDraftFingerprint } from "benchmark:draft";
import { authStore } from "../../../src/shared/auth/auth-store";
import "../../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const count = Number(params.get("blocks") || 100);
const variant = params.get("variant") || "text";
authStore.getState().setSession({ accessToken: "benchmark-local", refreshToken: null, user: { id: "benchmark", tenant_id: null, email: "benchmark@example.test", display_name: "Benchmark", current_workspace_id: "benchmark", status: "active", created_at_ms: 1, updated_at_ms: 1 }, workspace: { id: "benchmark", name: "Benchmark", workspace_type: "private", role: "owner", is_current: true, created_at_ms: 1, updated_at_ms: 1 } });
const paragraph = (id: string): OrbisBlock => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text: `段落 ${id} — Editable benchmark content with stable block identity. `.repeat(3) }], children: [] });
const makeBlock = (i: number): OrbisBlock => {
  const block = paragraph(`block-${i}`);
  if (i === 0 || i % 10 !== 0) return block;
  if (variant === "nested") return { ...block, type: "callout", props: { title: "Nested section", tone: "info" }, children: [paragraph(`child-${i}`)] };
  if (variant === "rich") return i % 20 === 0
    ? { ...block, type: "codeBlock", props: { language: "typescript" }, content: "const value = 42;\nconsole.log(value);" }
    : { ...block, type: "table", content: { type: "tableContent", rows: [{ cells: ["Name", "Value"] }, { cells: ["Benchmark", "42"] }] } };
  if (variant === "media") return { ...block, type: "image", props: { name: "Diagram", url: `orbis-file:0190a111-1111-7111-8111-${String(i).padStart(12, "0")}` }, content: [] };
  return block;
};
const initial: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: variant === "giant-container"
  ? [{ ...paragraph("giant-container"), children: Array.from({ length: count }, (_, i) => paragraph(`bench-child-${i}`)) }]
  : Array.from({ length: count }, (_, i) => makeBlock(i)) };
const metrics = { startedAt: performance.now(), changes: 0, commits: 0, fingerprintMs: [] as number[], saveCount: 0, saveBytes: 0, longTasks: [] as number[] };
new PerformanceObserver((list) => metrics.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: "longtask", buffered: true });
Object.assign(window, { benchmark: { metrics, fixture: { blocks: count, variant, bytes: JSON.stringify(initial).length } } });
const fingerprint = createEditorDraftFingerprint();
const coordinator = new AutosaveCoordinator<{ title: string; blocks: NoteBlocksV2; version: number }>({
  delayMs: 750, minIntervalMs: 2_000, maxDelayMs: 15_000,
  fingerprint: (draft) => {
    const start = performance.now();
    const result = fingerprint(draft);
    metrics.fingerprintMs.push(performance.now() - start);
    return result;
  },
  save: async (draft, saved) => {
    metrics.saveCount += 1;
    metrics.saveBytes += JSON.stringify(draft.blocks).length;
    return { ...draft, version: saved.version + 1 };
  },
});
coordinator.hydrate({ title: "Benchmark", blocks: initial, version: 1 });
function App() {
  const [blocks, setBlocks] = useState(initial);
  return <main style={{ maxWidth: 920, margin: "0 auto", padding: 32 }}><Profiler id="editor" onRender={() => { metrics.commits += 1; }}><TiptapEditor blocks={blocks} onChange={({ blocks: next }) => {
    metrics.changes += 1;
    Object.assign((window as unknown as { benchmark: object }).benchmark, { lastBlocks: next });
    setBlocks(next);
    coordinator.change({ title: "Benchmark", blocks: next, version: 1 });
  }} /></Profiler></main>;
}
createRoot(document.getElementById("root")!).render(<App />);
