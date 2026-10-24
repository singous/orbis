import { afterEach, expect, it, vi } from "vitest";
import { freshDraft, pendingWrite } from "../../src/features/quick-notes/draft";

afterEach(() => vi.unstubAllGlobals());
it("creates a retryable quick-note operation on trusted HTTP origins without randomUUID", () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const operation = pendingWrite(freshDraft());
  expect(operation.operation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(pendingWrite({ ...freshDraft(), pending: operation })).toBe(operation);
});
