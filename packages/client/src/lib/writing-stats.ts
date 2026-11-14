// 码字统计页（`#/stats`）的客户端派生口径（纯函数，单测覆盖；DESIGN.md「码字统计页」/ `130-api-writing-stats.md`）。
//
// 为什么不用 dayjs：本页只需要「本地日的字符串键 + 月矩阵」，`new Date(y, m, d)` 的本地日算术足够，
// 日键 = `YYYY-MM-DD` 纯字符串（与 `GET /writing-stats` 的 `today` / `days[].date` 同口径）。
// **不在这里生成「今天」**：今日日键是服务端权威值（`WritingStatsRes.today`），本模块只做展示派生。
//
// 阈值单一定义：热力档位边界只在 `WRITING_HEAT_THRESHOLDS` 出现一次，组件不得手写数字；
// 宽中栏阈值 `STATS_TWO_COLUMN_MIN_WIDTH` 与页面容器查询类字面量同值（见 pages/WritingStats.tsx）。
import type { WritingStatsRes } from "@whispering233/ai-editor-shared";

/** 一条按天统计（`days` 的元素形状同源 shared） */
export type WritingStatsDay = WritingStatsRes["days"][number];

/** 星期表头（周一起始，与年热力/月历的列序一致） */
export const WRITING_STATS_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** 年热力窗口天数（标题与格子范围同源） */
export const WRITING_HEATMAP_DAYS = 365;
/** 年热力列数（52 整周 + 1 天；周一对齐，任何年份都是 53 列） */
export const WRITING_HEATMAP_WEEKS = 53;

/** 热力正档下界（`chars >= 阈值` 即进该档；0 = 无记录；4 档上限） */
export const WRITING_HEAT_THRESHOLDS = [1, 200, 500, 1000] as const;

/** 档位值域（0 = 无记录 + 4 正档；页头图例与取档共用同一份） */
export const WRITING_HEAT_LEVELS = [0, 1, 2, 3, 4] as const;
export type WritingHeatLevel = (typeof WRITING_HEAT_LEVELS)[number];

/** 宽中栏阈值（px）：≥ 此宽度「月历 320 + 趋势」并排；类字面量 `@min-[<该值>px]` 在页面里 */
export const STATS_TWO_COLUMN_MIN_WIDTH = 720;

/** 趋势范围（顺序 = Segmented 顺序；`month` = 近 12 个月合计柱） */
export const WRITING_TREND_RANGES = [
  { key: "7", label: "近7天", days: 7 },
  { key: "15", label: "近15天", days: 15 },
  { key: "30", label: "近30天", days: 30 },
  { key: "month", label: "按月", days: null },
] as const;
export type WritingTrendKey = (typeof WRITING_TREND_RANGES)[number]["key"];
/** 「按月」的月数（近 12 月） */
export const WRITING_TREND_MONTHS = 12;

export interface DateParts {
  year: number;
  /** 0-based（与 `Date` 一致） */
  monthIndex: number;
  day: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地日键 `YYYY-MM-DD`（monthIndex 0-based） */
export function dateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/** 日键 → 本地日三段（monthIndex 0-based） */
export function parseDateKey(key: string): DateParts {
  const [year, month, day] = key.split("-").map(Number);
  return { year, monthIndex: month - 1, day };
}

/** 向前/后平移天数（本地日，跨月/跨年由 `Date` 归一） */
export function addDays(key: string, delta: number): string {
  const { year, monthIndex, day } = parseDateKey(key);
  const shifted = new Date(year, monthIndex, day + delta);
  return dateKey(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
}

/** 平移月份（回到该月 1 日算，避免月末日期溢出） */
export function addMonths(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; monthIndex: number } {
  const shifted = new Date(year, monthIndex + delta, 1);
  return { year: shifted.getFullYear(), monthIndex: shifted.getMonth() };
}

/** 该月天数（闰年 2 月自动 29） */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** 周一起始的星期序号（0 = 周一 … 6 = 周日） */
export function weekdayIndex(key: string): number {
  const { year, monthIndex, day } = parseDateKey(key);
  return (new Date(year, monthIndex, day).getDay() + 6) % 7;
}

/** 月历矩阵：7 列、周一起始，前后空位为 `null`（行数随月长变化） */
export function monthMatrix(year: number, monthIndex: number): (string | null)[][] {
  const cells: (string | null)[] = Array.from(
    { length: weekdayIndex(dateKey(year, monthIndex, 1)) },
    () => null,
  );
  for (let day = 1; day <= daysInMonth(year, monthIndex); day += 1) {
    cells.push(dateKey(year, monthIndex, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));
  return rows;
}

/** 月份展示文案（`2026年11月`） */
export function monthLabel(year: number, monthIndex: number): string {
  return `${year}年${monthIndex + 1}月`;
}

/** 日键 → `11月15日` 展示文案（柱状图 title / 选中日） */
export function dayLabel(key: string): string {
  const { monthIndex, day } = parseDateKey(key);
  return `${monthIndex + 1}月${day}日`;
}

/** 近 N 天（升序，末位 = today） */
export function lastNDays(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => addDays(today, index - days + 1));
}

/** 近 N 个月（升序，末位 = today 所在月） */
export function lastNMonths(
  today: string,
  months: number,
): { year: number; monthIndex: number }[] {
  const { year, monthIndex } = parseDateKey(today);
  return Array.from({ length: months }, (_, index) =>
    addMonths(year, monthIndex, index - months + 1),
  );
}

/** 日键 → 当日字数（不建行 = 0） */
export function charsByDate(days: readonly WritingStatsDay[]): Map<string, number> {
  return new Map(days.map((day) => [day.date, day.chars]));
}

export interface MonthSummary {
  chars: number;
  /** 该月有码字记录的天数（统计行只含有正增量的日期） */
  activeDays: number;
}

/** 某月合计与活跃天数（日键 → 字数映射） */
export function monthSummary(
  chars: ReadonlyMap<string, number>,
  year: number,
  monthIndex: number,
): MonthSummary {
  let total = 0;
  let activeDays = 0;
  for (let day = 1; day <= daysInMonth(year, monthIndex); day += 1) {
    const value = chars.get(dateKey(year, monthIndex, day)) ?? 0;
    if (value > 0) {
      total += value;
      activeDays += 1;
    }
  }
  return { chars: total, activeDays };
}

export interface WritingSeriesPoint {
  key: string;
  /** 柱下标签（按月模式显示） */
  label: string;
  /** 原生 title 的日期/月份文案 */
  title: string;
  chars: number;
}

/** 趋势柱状序列（近 7/15/30 天 = 逐日；按月 = 近 12 月合计） */
export function trendSeries(
  days: readonly WritingStatsDay[],
  today: string,
  range: WritingTrendKey,
): WritingSeriesPoint[] {
  const chars = charsByDate(days);
  if (range === "month") {
    return lastNMonths(today, WRITING_TREND_MONTHS).map(({ year, monthIndex }) => ({
      key: dateKey(year, monthIndex, 1),
      label: `${monthIndex + 1}月`,
      title: monthLabel(year, monthIndex),
      chars: monthSummary(chars, year, monthIndex).chars,
    }));
  }
  const size = WRITING_TREND_RANGES.find((option) => option.key === range)?.days ?? 0;
  return lastNDays(today, size).map((key) => ({
    key,
    label: String(parseDateKey(key).day),
    title: dayLabel(key),
    chars: chars.get(key) ?? 0,
  }));
}

export interface SeriesSummary {
  total: number;
  /** 日均 = 合计 ÷ 区间天数（含 0 字日，四舍五入） */
  average: number;
  max: number;
}

/** 区间合计 / 日均 / 最高（空区间全 0） */
export function summarizeChars(values: readonly number[]): SeriesSummary {
  if (values.length === 0) return { total: 0, average: 0, max: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { total, average: Math.round(total / values.length), max: Math.max(...values) };
}

/** 热力档位：0 = 无记录，1..4 = 正档（阈值只取 `WRITING_HEAT_THRESHOLDS`） */
export function writingHeatLevel(chars: number): WritingHeatLevel {
  if (chars <= 0) return 0;
  let level = 0;
  for (const threshold of WRITING_HEAT_THRESHOLDS) {
    if (chars >= threshold) level += 1;
  }
  return WRITING_HEAT_LEVELS[level] ?? 0;
}

/** 年热力窗口（`today` 往前推 `WRITING_HEATMAP_DAYS` 天，含首尾） */
export function heatmapWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -(WRITING_HEATMAP_DAYS - 1)), to: today };
}

/** 年热力网格：`WRITING_HEATMAP_WEEKS` 列 × 7 行，周一起始；窗口外为 `null` */
export function heatmapWeeks(today: string): (string | null)[][] {
  const { from } = heatmapWindow(today);
  const gridStart = addDays(from, -weekdayIndex(from));
  return Array.from({ length: WRITING_HEATMAP_WEEKS }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const key = addDays(gridStart, week * 7 + weekday);
      return key < from || key > today ? null : key;
    }),
  );
}

/** 千分位（统计页只展示正整数；不做 K/M 缩写） */
export function formatChars(chars: number): string {
  return String(chars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}