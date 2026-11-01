import { cn } from "@orbis/ui/cn";
import type { CSSProperties } from "react";
import { Skeleton } from "@orbis/ui/skeleton";
import { LoadingState, loadingLineClassName } from "../../shared/ui/LoadingState";
import { HomeCard, HomeCardHeading } from "./HomeLayout";
import type { buildActivityCalendar } from "./home-activity";

const CALENDAR_DAY_CLASSES = "home-calendar-day block aspect-square min-w-0 rounded-ob-sm bg-ob-surface-secondary data-[level=1]:bg-[color-mix(in_oklab,var(--ob-icon-mint)_15%,var(--ob-surface))] data-[level=2]:bg-[color-mix(in_oklab,var(--ob-icon-mint)_30%,var(--ob-surface))] data-[level=3]:bg-[color-mix(in_oklab,var(--ob-icon-mint)_60%,var(--ob-surface))] data-[level=4]:bg-(--ob-icon-mint) data-future:border data-future:border-ob-surface-edge data-future:bg-transparent";

type HomeActivityProps = { state: "skeleton" } | {
  state: "ready" | "pending" | "unavailable";
  activity: ReturnType<typeof buildActivityCalendar>;
  noteCount: number;
  quickNoteCount: number;
};

/** 启动占位和已加载首页共用足迹卡片，数据与查询仍由页面拥有。 */
export function HomeActivityCard(props: HomeActivityProps) {
  if (props.state === "skeleton") return <HomeCard className="workspace-loading-panel grid min-h-60 gap-6">
    <Skeleton animationType="pulse" className={cn(loadingLineClassName, "loading-line--short w-[64%]")} />
    {[0, 1, 2].map(row => <Skeleton animationType="pulse" className={loadingLineClassName} key={row} />)}
  </HomeCard>;
  const { state, activity, noteCount, quickNoteCount } = props;
  const ready = state === "ready";
  return (
        <HomeCard className="home-activity flex flex-col" aria-label="灵感足迹">
          <HomeCardHeading title="灵感足迹" description="认真记录的日子，都在这里。" className="mb-6 flex-col items-start gap-2 min-[541px]:flex-row min-[541px]:items-center min-[1001px]:flex-col min-[1001px]:items-start min-[1201px]:flex-row min-[1201px]:items-center min-[1201px]:gap-4" actions={<span className="home-activity-summary text-xs whitespace-nowrap text-ob-muted-foreground">本月记录了 {ready ? activity.activeDays : "—"} 天</span>} />
          {state === "pending" ? <LoadingState label="正在加载灵感足迹…" /> : null}
          <div className="home-calendar" style={{ "--home-calendar-weeks": activity.months.length } as CSSProperties} role="img" aria-label={ready ? `近期内容足迹，本月有 ${activity.activeDays} 个记录日。按当前内容的创建和最近编辑日期统计。` : "灵感足迹尚未加载"}>
            <div className="home-calendar-days grid grid-flow-col grid-cols-[repeat(var(--home-calendar-weeks),minmax(0,1fr))] grid-rows-7 gap-1">{activity.days.map(day => <span key={day.date} className={`${CALENDAR_DAY_CLASSES}${day.future ? " is-future" : ""}`} data-future={day.future || undefined} data-level={ready && !day.future ? Math.min(day.count, 4) : 0} title={day.future ? `${day.date}：尚未到来` : ready ? `${day.date}：${day.count} 条内容` : "尚未加载"} />)}</div>
            <div className="home-calendar-months mt-2 grid grid-cols-[repeat(var(--home-calendar-weeks),minmax(0,1fr))] text-xs text-ob-muted-foreground">{activity.months.map(month => <span className="whitespace-nowrap" key={month.date}>{month.label}</span>)}</div>
          </div>
          <div className="home-calendar-legend mt-3 flex items-center justify-end gap-1 text-xs text-ob-muted-foreground" aria-hidden="true"><span>少</span>{[0, 1, 2, 3, 4].map(level => <span key={level} className={`${CALENDAR_DAY_CLASSES} w-4`} data-level={level} />)}<span>多</span></div>
          <p className="home-activity-scope mt-3 mb-6 text-xs text-ob-muted-foreground">依据最近 {noteCount} 篇文档与 {quickNoteCount} 条随手记的创建及最近编辑日期</p>
          <footer className="home-activity-footer flex flex-1 items-center justify-center border-t border-ob-surface-edge pt-6 text-center"><span className="rounded-ob-lg bg-ob-warning-soft px-6 py-2">今天，也给想法留一点位置。</span></footer>
        </HomeCard>
  );
}
