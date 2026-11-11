const BUSINESS_TIME_ZONE = "Asia/Shanghai";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const businessDay = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function documentEditPeriod(value: number, now: number): "今天" | "昨天" | "过去 7 天" | "更早" {
  const day = businessDay.format(value);
  if (day === businessDay.format(now)) return "今天";
  if (day === businessDay.format(now - MILLISECONDS_PER_DAY)) return "昨天";
  return day >= businessDay.format(now - 6 * MILLISECONDS_PER_DAY) ? "过去 7 天" : "更早";
}

/** 目录展示使用北京时间；跨年保留年份，完整时间由 time 元素提供。 */
export function formatNotebookUpdateTime(value: number, now = Date.now()): string {
  const date = new Date(value);
  const day = businessDay.format(date);
  const today = businessDay.format(now);
  const yesterday = businessDay.format(now - MILLISECONDS_PER_DAY);
  const label = day === today ? "今天" : day === yesterday ? "昨天" : day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day;
  return `${label} ${clock.format(date)}`;
}
