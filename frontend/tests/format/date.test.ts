import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("uses the business UTC+8 day even when the browser timezone is UTC", async () => {
  vi.stubEnv("TZ", "UTC");
  vi.resetModules();
  const { formatDate } = await import("../../src/shared/format/date");
  expect(formatDate(Date.parse("2026-10-23T16:30:00Z"))).toBe("10月24日");
});
