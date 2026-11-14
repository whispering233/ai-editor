// 年度码字热力（DESIGN.md「码字统计页」→「年度热力」）：
// 53 周 × 7 行、周一起始、全宽放在最后；周列 `flex-1` 铺满宽中栏、`min-w-2.5` 保底 10px ⇒ 窄中栏才横向滚动；
// 0 档 = `bg-accent`（surface-muted），正档由 `bg-primary` 透明度派生；
// 点格子 = 选中该日（页面据此跳到对应月）。
// 档位阈值只取 `lib/writing-stats.ts` 的 `WRITING_HEAT_THRESHOLDS`，组件不手写数字；宽度/天数同源常量。
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "../../lib/utils";
import {
  formatChars,
  heatmapWeeks,
  WRITING_HEAT_LEVELS,
  WRITING_HEATMAP_DAYS,
  writingHeatLevel,
  type WritingHeatLevel,
} from "../../lib/writing-stats";

/** 档位 → 底色类（字面量查表：Tailwind 只扫字面量类名，禁止拼接） */
const HEAT_CELL_CLASS: Record<WritingHeatLevel, string> = {
  0: "bg-accent",
  1: "bg-primary/20",
  2: "bg-primary/40",
  3: "bg-primary/60",
  4: "bg-primary/80",
};

const HEAT_LEVELS: readonly WritingHeatLevel[] = WRITING_HEAT_LEVELS;

export interface YearHeatmapProps {
  /** 日键 → 当日字数 */
  charsByDate: ReadonlyMap<string, number>;
  /** 服务端本地日（网格末列 = today） */
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

/** 年热力卡（纯展示：点选回调交给页面处理跳月） */
export function YearHeatmap({ charsByDate, today, selectedDate, onSelectDate }: YearHeatmapProps) {
  const weeks = heatmapWeeks(today);
  let activeDays = 0;
  for (const week of weeks) {
    for (const cell of week) {
      if (cell !== null && (charsByDate.get(cell) ?? 0) > 0) activeDays += 1;
    }
  }

  return (
    <SectionCard title={`码字热力 · 近 ${WRITING_HEATMAP_DAYS} 天`}>
      <div className="overflow-x-auto">
        <div className="flex w-full gap-0.5">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-1 min-w-2.5 flex-col gap-0.5">
              {week.map((cell, weekdayIndex) => {
                if (cell === null) return <div key={weekdayIndex} className="aspect-square w-full" />;
                const chars = charsByDate.get(cell) ?? 0;
                const selected = cell === selectedDate;
                return (
                  <button
                    key={weekdayIndex}
                    type="button"
                    title={`${cell} · ${formatChars(chars)} 字`}
                    aria-label={`${cell} · ${formatChars(chars)} 字`}
                    aria-pressed={selected}
                    onClick={() => onSelectDate(cell)}
                    className={cn(
                      "aspect-square w-full rounded-sm hover:ring-1 hover:ring-primary",
                      HEAT_CELL_CLASS[writingHeatLevel(chars)],
                      selected && "ring-1 ring-primary",
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>少</span>
        {HEAT_LEVELS.map((level) => (
          <span key={level} className={cn("h-2.5 w-2.5 rounded-sm", HEAT_CELL_CLASS[level])} />
        ))}
        <span>多</span>
        <span className="@min-[720px]:ml-auto tabular-nums">活跃 {activeDays} 天</span>
      </div>
    </SectionCard>
  );
}