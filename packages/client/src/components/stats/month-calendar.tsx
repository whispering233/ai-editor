// 码字日历（月历，DESIGN.md「码字统计页」→「码字日历（月历）」）：
// 7 列、周一起始；每格 = 日号 + 仅正字数时显示当日字数；点格选中日期；标题行 = 翻月 + 今天。
// 月矩阵 / 月合计 / 千分位全部取 `lib/writing-stats.ts`（阈值与派生不在组件里手写）。
import { Button } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { cn } from "../../lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import {
  addMonths,
  dayLabel,
  formatChars,
  monthLabel,
  monthMatrix,
  parseDateKey,
  WRITING_STATS_WEEKDAYS,
} from "../../lib/writing-stats";

export interface MonthCalendarProps {
  year: number;
  /** 0-based（与 `Date` 一致） */
  monthIndex: number;
  /** 日键 → 当日字数 */
  charsByDate: ReadonlyMap<string, number>;
  /** 服务端本地日（今天按钮与选中判定） */
  today: string;
  selectedDate: string;
  onMonthChange: (year: number, monthIndex: number) => void;
  onSelectDate: (date: string) => void;
}

/** 月历卡（纯展示：月份与选中日由页面持有——年热力点选要能跳到对应月） */
export function MonthCalendar({
  year,
  monthIndex,
  charsByDate,
  today,
  selectedDate,
  onMonthChange,
  onSelectDate,
}: MonthCalendarProps) {
  const rows = monthMatrix(year, monthIndex);
  let monthChars = 0;
  let activeDays = 0;
  for (const cell of rows.flat()) {
    const chars = cell === null ? 0 : (charsByDate.get(cell) ?? 0);
    if (chars > 0) {
      monthChars += chars;
      activeDays += 1;
    }
  }
  const selectedChars = charsByDate.get(selectedDate) ?? 0;
  const shiftMonth = (delta: number) => {
    const next = addMonths(year, monthIndex, delta);
    onMonthChange(next.year, next.monthIndex);
  };

  return (
    <SectionCard
      title="码字日历"
      action={
        <span className="flex items-center gap-1">
          <Button
            size="small"
            color="default"
            variant="text"
            icon={<LeftOutlined />}
            aria-label="上个月"
            title="上个月"
            onClick={() => shiftMonth(-1)}
          />
          <span className="text-sm whitespace-nowrap tabular-nums">{monthLabel(year, monthIndex)}</span>
          <Button
            size="small"
            color="default"
            variant="text"
            icon={<RightOutlined />}
            aria-label="下个月"
            title="下个月"
            onClick={() => shiftMonth(1)}
          />
          <Button size="small" onClick={() => onSelectDate(today)}>
            今天
          </Button>
        </span>
      }
    >
      <div className="grid grid-cols-7 gap-1">
        {WRITING_STATS_WEEKDAYS.map((weekday) => (
          <div key={weekday} className="text-center text-xs text-muted-foreground">
            {weekday}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {rows.flat().map((cell, index) => {
          if (cell === null) return <div key={`empty-${index}`} className="h-10" />;
          const chars = charsByDate.get(cell) ?? 0;
          const selected = cell === selectedDate;
          return (
            <button
              key={cell}
              type="button"
              title={`${cell} · ${formatChars(chars)} 字`}
              aria-label={`${dayLabel(cell)} · ${formatChars(chars)} 字`}
              aria-pressed={selected}
              onClick={() => onSelectDate(cell)}
              className={cn(
                "flex h-10 min-w-0 flex-col items-center justify-center rounded-md border border-transparent text-center hover:bg-muted",
                selected && "border-primary bg-accent",
              )}
            >
              <span className="text-sm tabular-nums">{parseDateKey(cell).day}</span>
              {chars > 0 && (
                <span className="w-full truncate px-0.5 text-center text-xs text-muted-foreground tabular-nums">
                  {formatChars(chars)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/50 pt-3">
        <div>
          <div className="text-xs text-muted-foreground">选中日字数</div>
          <div className="text-sm tabular-nums">{formatChars(selectedChars)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">本月累计</div>
          <div className="text-sm tabular-nums">{formatChars(monthChars)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">本月活跃天数</div>
          <div className="text-sm tabular-nums">{activeDays}</div>
        </div>
      </div>
    </SectionCard>
  );
}