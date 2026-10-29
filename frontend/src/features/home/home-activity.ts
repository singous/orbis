const DAY_MS = 86_400_000;
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000;
const CALENDAR_WEEKS = 22;

/** UTC+8 business dates, independent of the browser's local timezone. */
export function businessDay(timestamp: number): string {
  return new Date(timestamp + BUSINESS_OFFSET_MS).toISOString().slice(0, 10);
}

export function memberDays(createdAt: number, now: number): number {
  return Math.max(1, Math.round((Date.parse(businessDay(now)) - Date.parse(businessDay(createdAt))) / DAY_MS) + 1);
}

export function buildActivityCalendar(records: { created_at_ms: number; updated_at_ms: number }[], now: number) {
  const today = businessDay(now);
  const todayUTC = Date.parse(today);
  const start = todayUTC - (new Date(todayUTC).getUTCDay() + (CALENDAR_WEEKS - 1) * 7) * DAY_MS;
  const counts = new Map<string, number>();
  for (const record of records) {
    // A record contributes at most once per day; metadata is not an edit history.
    for (const day of new Set([businessDay(record.created_at_ms), businessDay(record.updated_at_ms)])) {
      if (day <= today) counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  const days = Array.from({ length: CALENDAR_WEEKS * 7 }, (_, index) => {
    const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0, future: date > today };
  });
  const months = days.filter((_, index) => index % 7 === 0).map((day, index) => {
    const monthStart = days.slice(index * 7, (index + 1) * 7).find(item => item.date.endsWith("-01") && !item.future);
    const labelDate = monthStart?.date ?? (index === 0 ? day.date : null);
    return { label: labelDate ? `${Number(labelDate.slice(5, 7))} 月` : "", date: day.date };
  });
  return { days, months, activeDays: [...counts.keys()].filter(day => day.startsWith(today.slice(0, 7))).length };
}
