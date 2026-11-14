// 码字趋势（DESIGN.md「码字统计页」→「码字趋势」）：Segmented 切近 7/15/30 天 / 按月（近 12 月），
// 自绘柱状（CSS 高度百分比、柱色 `bg-primary`），每柱原生 `title`；图下三格 = 合计 / 日均 / 最高。
// 序列与汇总全部取自 `lib/writing-stats.ts`（`trendSeries` / `summarizeChars`），组件不重算窗口。
import { Segmented } from "antd";
import { SectionCard } from "@/components/ui/section-card";
import {
  formatChars,
  summarizeChars,
  trendSeries,
  WRITING_TREND_RANGES,
  type WritingStatsDay,
  type WritingTrendKey,
} from "../../lib/writing-stats";

/** Segmented 选项（顺序 = 常量表顺序：近7天 / 近15天 / 近30天 / 按月） */
const TREND_OPTIONS = WRITING_TREND_RANGES.map(({ key, label }) => ({ value: key, label }));

export interface DailyBarsProps {
  days: readonly WritingStatsDay[];
  /** 服务端本地日（窗口末位） */
  today: string;
  range: WritingTrendKey;
  onRangeChange: (range: WritingTrendKey) => void;
}

/** 趋势卡（纯展示） */
export function DailyBars({ days, today, range, onRangeChange }: DailyBarsProps) {
  const series = trendSeries(days, today, range);
  const { total, average, max } = summarizeChars(series.map((point) => point.chars));

  return (
    <SectionCard
      title="码字趋势"
      action={
        <Segmented<WritingTrendKey>
          size="small"
          options={TREND_OPTIONS}
          value={range}
          onChange={onRangeChange}
        />
      }
    >
      <div className="flex h-32 items-end gap-1">
        {series.map((point) => (
          <div
            key={point.key}
            title={`${point.title} · ${formatChars(point.chars)} 字`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
          >
            {point.chars > 0 && (
              <div
                className="w-full rounded-sm bg-primary"
                style={{ height: `${max === 0 ? 0 : (point.chars / max) * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>

      {/* 按月模式才标月名（逐日模式的日期在原生 title 里，不挤 30 个日号） */}
      {range === "month" && (
        <div className="mt-1 flex gap-1 text-center text-xs text-muted-foreground">
          {series.map((point) => (
            <span key={point.key} className="min-w-0 flex-1 truncate">
              {point.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/50 pt-3">
        <div>
          <div className="text-xs text-muted-foreground">合计</div>
          <div className="text-sm tabular-nums">{formatChars(total)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">日均</div>
          <div className="text-sm tabular-nums">{formatChars(average)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">最高</div>
          <div className="text-sm tabular-nums">{formatChars(max)}</div>
        </div>
      </div>
    </SectionCard>
  );
}