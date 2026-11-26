// 码字统计页（小说工作区 `#/stats`；DESIGN.md「码字统计页」/ docs/api/130-api-writing-stats.md）。
//
// 契约要点：
// - 页头常驻模板（`section: h-full min-h-0 flex flex-col` + 内层 `flex min-h-0 flex-1 flex-col
//   overflow-y-auto`）；不新增色值 / 字号 / 圆角 / 阴影，图表不引第三方库（自绘 CSS 柱 / 格子）。
// - 数据只发一次 `GET /writing-stats`；月/年聚合、热力档位、窗口全部客户端派生（`lib/writing-stats.ts`）。
// - 宽中栏 = 摘要 4 列 +「月历 320 + 趋势」并排 + 年热力全宽；窄中栏全部堆叠。**容器查询，不按 viewport**
//   ——阈值常量 `STATS_TWO_COLUMN_MIN_WIDTH`（lib/writing-stats.ts）与 `@min-[<值>px]` 类字面量同值（Tailwind 只扫字面量类名，
//   同值断言见 lib/writing-stats.test.ts；先例 = components/chat/session-status-bar.tsx）。
// - 无数据 = 摘要 0 + 两个 EmptyState，不渲染空轴图；「本次会话」卡归悬浮面板，本页不画。
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Skeleton } from "antd";
import type { WritingStatsRes } from "@whispering233/ai-editor-shared";
import { ApiError, getWritingStats } from "../lib/api";
import {
  charsByDate,
  dateKey,
  daysInMonth,
  formatChars,
  monthSummary,
  parseDateKey,
  WRITING_TREND_RANGES,
  type WritingTrendKey,
} from "../lib/writing-stats";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { MonthCalendar } from "@/components/stats/month-calendar";
import { DailyBars } from "@/components/stats/daily-bars";
import { YearHeatmap } from "@/components/stats/year-heatmap";
import { GoalCard } from "@/components/stats/goal-card";
import { useProjectStore } from "../stores/project";

/** 四张摘要卡（顺序 = DESIGN.md 摘要区顺序：「今日」读服务端 today 日键） */
const METRIC_LABELS = ["今日", "本月", "累计", "码字天数"] as const;

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <SectionCard>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl tabular-nums">{formatChars(value)}</div>
    </SectionCard>
  );
}

/** 加载态：摘要 + 两块卡骨架（DESIGN.md「状态」） */
function StatsSkeleton() {
  return (
    <div className="@container flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 @min-[720px]:grid-cols-4">
        {METRIC_LABELS.map((label) => (
          <SectionCard key={label}>
            <Skeleton active title={false} paragraph={{ rows: 1 }} />
          </SectionCard>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 @min-[720px]:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard title="码字日历">
          <Skeleton active title={false} paragraph={{ rows: 6 }} />
        </SectionCard>
        <SectionCard title="码字趋势">
          <Skeleton active title={false} paragraph={{ rows: 4 }} />
        </SectionCard>
      </div>
    </div>
  );
}

export default function WritingStats() {
  const config = useProjectStore((s) => s.config);
  /** 每日目标偏好按书隔离（key 里带项目 id） */
  const projectId = config?.id ?? null;
  const [stats, setStats] = useState<WritingStatsRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  /** 选中日（月历与热力共用；首帧取服务端 today，月视图跟随选中日） */
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<WritingTrendKey>(WRITING_TREND_RANGES[0].key);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    getWritingStats()
      .then((res) => {
        if (cancelled) return;
        setStats(res);
        setSelectedDate((previous) => previous ?? res.today);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : "加载失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const chars = useMemo(() => charsByDate(stats?.days ?? []), [stats]);

  /** 月历翻月 = 把选中日挪到目标月的同一天（月末溢出取该月最后一天） */
  function handleMonthChange(year: number, monthIndex: number): void {
    if (selectedDate === null) return;
    const day = Math.min(parseDateKey(selectedDate).day, daysInMonth(year, monthIndex));
    setSelectedDate(dateKey(year, monthIndex, day));
  }

  const todayParts = stats === null ? null : parseDateKey(stats.today);
  const thisMonth =
    stats === null || todayParts === null
      ? 0
      : monthSummary(chars, todayParts.year, todayParts.monthIndex).chars;
  const values: Record<(typeof METRIC_LABELS)[number], number> | null =
    stats === null
      ? null
      : {
          今日: chars.get(stats.today) ?? 0,
          本月: thisMonth,
          累计: stats.totalChars,
          码字天数: stats.totalDays,
        };
  // 选中日缺省 = 服务端 today（首帧与「只有统计没有选中」的防御；月视图跟随选中日）
  const effectiveDate = selectedDate ?? stats?.today ?? null;
  const cursor = effectiveDate === null ? null : parseDateKey(effectiveDate);
  const empty = stats !== null && stats.days.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="码字统计"
        description={
          <span className="text-xs text-muted-foreground">按天累计新增正文字数 · 删除不扣减</span>
        }
      />

      {error !== null && (
        <Alert
          className="mb-2"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => setReloadTick((tick) => tick + 1)}>
              重试
            </Button>
          }
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {stats === null
          ? error === null && <StatsSkeleton />
          : cursor !== null && (
              <div className="@container flex flex-col gap-4">
                {values !== null && (
                  <div className="grid grid-cols-2 gap-3 @min-[720px]:grid-cols-4">
                    {METRIC_LABELS.map((label) => (
                      <StatCard key={label} label={label} value={values[label]} />
                    ))}
                  </div>
                )}

                <GoalCard days={stats.days} today={stats.today} projectId={projectId} />

                <div className="grid grid-cols-1 gap-4 @min-[720px]:grid-cols-[320px_minmax(0,1fr)]">
                  {empty ? (
                    <>
                      <EmptyState padding="sm">还没有码字记录</EmptyState>
                      <EmptyState padding="sm">保存章正文后开始统计</EmptyState>
                    </>
                  ) : (
                    <>
                      <MonthCalendar
                        year={cursor.year}
                        monthIndex={cursor.monthIndex}
                        charsByDate={chars}
                        today={stats.today}
                        selectedDate={effectiveDate ?? stats.today}
                        onMonthChange={handleMonthChange}
                        onSelectDate={setSelectedDate}
                      />
                      <DailyBars
                        days={stats.days}
                        today={stats.today}
                        range={trendRange}
                        onRangeChange={setTrendRange}
                      />
                      <div className="@min-[720px]:col-span-2">
                        <YearHeatmap
                          charsByDate={chars}
                          today={stats.today}
                          selectedDate={effectiveDate ?? stats.today}
                          onSelectDate={setSelectedDate}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
      </div>
    </section>
  );
}