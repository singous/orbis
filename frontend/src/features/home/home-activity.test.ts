import { expect, it } from "vitest";
import { buildActivityCalendar, businessDay, memberDays } from "./home-activity";

it("uses business-day boundaries across midnight and month changes", () => {
  expect(businessDay(Date.parse("2026-10-31T16:00:00Z"))).toBe("2026-11-01");
  expect(memberDays(Date.parse("2026-10-30T15:59:00Z"), Date.parse("2026-10-30T16:01:00Z"))).toBe(2);
});

it("counts one contribution per record per day and excludes future dates", () => {
  const now = Date.parse("2026-10-30T09:00:00Z");
  const calendar = buildActivityCalendar([
    { created_at_ms: now, updated_at_ms: now },
    { created_at_ms: Date.parse("2026-09-30T16:00:00Z"), updated_at_ms: now },
    { created_at_ms: Date.parse("2026-09-30T15:59:00Z"), updated_at_ms: Date.parse("2026-10-31T16:00:00Z") },
  ], now);
  expect(calendar.days.find(day => day.date === "2026-10-30")?.count).toBe(2);
  expect(calendar.activeDays).toBe(2);
  expect(calendar.days).toHaveLength(154);
  expect(new Date(calendar.days[0].date).getUTCDay()).toBe(0);
  expect(calendar.days.filter(day => day.future).every(day => day.count === 0)).toBe(true);
});

it("shows an empty calendar without fabricated activity", () => {
  const calendar = buildActivityCalendar([], Date.parse("2026-01-01T00:00:00Z"));
  expect(calendar.activeDays).toBe(0);
  expect(calendar.days.every(day => day.count === 0)).toBe(true);
  expect(calendar.months.some(month => month.label === "1 月")).toBe(true);
});
