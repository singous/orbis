import { describe, expect, it } from "vitest";
import { formatNotebookUpdateTime } from "./notebook-update-time";

describe("notebook directory update times", () => {
  const now = Date.parse("2026-10-24T08:00:00Z");

  it.each([
    ["2026-10-23T16:00:00Z", "今天 00:00"],
    ["2026-10-24T08:01:00Z", "今天 16:01"],
    ["2026-10-23T15:59:00Z", "昨天 23:59"],
    ["2026-10-22T16:00:00Z", "昨天 00:00"],
    ["2026-10-22T08:14:00Z", "10-22 16:14"],
    ["2025-10-22T08:14:00Z", "2025-10-22 16:14"],
  ])("formats %s in the business timezone", (value, expected) => {
    expect(formatNotebookUpdateTime(Date.parse(value), now)).toBe(expected);
  });

  it("recognizes yesterday across the year boundary", () => {
    expect(formatNotebookUpdateTime(Date.parse("2025-12-31T15:30:00Z"), Date.parse("2025-12-31T16:15:00Z"))).toBe("昨天 23:30");
  });
});
