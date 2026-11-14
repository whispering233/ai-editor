// 码字统计纯函数（`#/stats` 页面派生口径）单测：日期键 / 月矩阵 / 翻月 / 窗口 / 聚合 / 热力档位 / 格式化。
// 覆盖 DESIGN.md「码字统计页」的派生边界：闰年 2 月、跨年翻月、月首对齐、近 N 天、近 12 月聚合、
// 档位边界（阈值单一定义处 = WRITING_HEAT_THRESHOLDS）、合计/日均/最高、容量（年热力 53×7）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  charsByDate,
  dateKey,
  dayLabel,
  daysInMonth,
  formatChars,
  heatmapWeeks,
  heatmapWindow,
  lastNDays,
  lastNMonths,
  monthLabel,
  monthMatrix,
  monthSummary,
  parseDateKey,
  STATS_TWO_COLUMN_MIN_WIDTH,
  summarizeChars,
  trendSeries,
  weekdayIndex,
  WRITING_HEAT_THRESHOLDS,
  WRITING_HEATMAP_DAYS,
  WRITING_HEATMAP_WEEKS,
  WRITING_TREND_MONTHS,
  writingHeatLevel,
} from "./writing-stats";

const day = (date: string, chars: number) => ({ date, chars });

describe("日期键与本地日算术", () => {
  it("日键 / 解析同源（monthIndex 0-based）", () => {
    expect(dateKey(2026, 10, 5)).toBe("2026-11-05");
    expect(parseDateKey("2026-11-05")).toEqual({ year: 2026, monthIndex: 10, day: 5 });
  });

  it("平移天数跨月 / 跨年由本地 Date 归一", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // 闰年
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("翻月跨年（不把月末日期带过去）", () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 });
    expect(addMonths(2026, 10, 0)).toEqual({ year: 2026, monthIndex: 10 });
  });

  it("天数：闰年 2 月 29 / 平年 2 月 28 / 大小月", () => {
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2026, 10)).toBe(30);
    expect(daysInMonth(2026, 11)).toBe(31);
  });

  it("周一起始星期序号（周日 = 6，周一 = 0）", () => {
    expect(weekdayIndex("2026-11-01")).toBe(6); // 2026-11-01 周日
    expect(weekdayIndex("2026-06-01")).toBe(0); // 2026-06-01 周一
    expect(weekdayIndex("2024-02-01")).toBe(3); // 2024-02-01 周四
  });

  it("展示文案", () => {
    expect(monthLabel(2026, 10)).toBe("2026年11月");
    expect(dayLabel("2026-11-05")).toBe("11月5日");
  });
});

describe("月矩阵（7 列、周一起始、月首对齐）", () => {
  it("月首非周一时前面补空位（2026-11-01 周日 → 6 个空位）", () => {
    const rows = monthMatrix(2026, 10);
    expect(rows[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(rows[0][6]).toBe("2026-11-01");
    expect(rows.length).toBe(6);
    expect(rows.flat().filter((cell) => cell !== null)).toHaveLength(30);
  });

  it("月首恰为周一时不补空位（2026-06-01 周一）", () => {
    const rows = monthMatrix(2026, 5);
    expect(rows[0][0]).toBe("2026-06-01");
    expect(rows.flat().filter((cell) => cell !== null)).toHaveLength(30);
  });

  it("闰年 2 月含 29 日且整行补齐（2024-02 周四起始 → 5 行）", () => {
    const rows = monthMatrix(2024, 1);
    expect(rows.length).toBe(5);
    const cells = rows.flat();
    expect(cells).toContain("2024-02-29");
    expect(cells.every((cell, index) => index % 7 < 5)).toBe(false); // 每行 7 列（含 2 个尾空位）
    expect(cells).toHaveLength(35);
  });
});

describe("窗口：近 N 天 / 近 N 月", () => {
  it("近 5 天跨年升序，末位 = today", () => {
    expect(lastNDays("2026-01-02", 5)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("近 12 个月升序，末位 = today 所在月（跨年）", () => {
    const months = lastNMonths("2026-11-15", WRITING_TREND_MONTHS);
    expect(months).toHaveLength(WRITING_TREND_MONTHS);
    expect(months[0]).toEqual({ year: 2025, monthIndex: 11 });
    expect(months[months.length - 1]).toEqual({ year: 2026, monthIndex: 10 });
  });
});

describe("聚合与合计", () => {
  const days = [
    day("2025-12-31", 100),
    day("2026-01-01", 50),
    day("2026-02-01", 200),
    day("2026-11-15", 300),
  ]; // 服务端只返回正增量的日期

  it("日键映射（无记录 = 未命中）", () => {
    const map = charsByDate(days);
    expect(map.get("2026-01-01")).toBe(50);
    expect(map.get("2026-01-03")).toBeUndefined();
  });

  it("月合计只累计该月行，活跃天数 = 有字数日数", () => {
    const map = charsByDate(days);
    expect(monthSummary(map, 2026, 0)).toEqual({ chars: 50, activeDays: 1 });
    expect(monthSummary(map, 2025, 11)).toEqual({ chars: 100, activeDays: 1 });
    expect(monthSummary(map, 2026, 3)).toEqual({ chars: 0, activeDays: 0 });
  });

  it("近 7 天逐日取数（0 字日保留为 0 柱）", () => {
    const series = trendSeries(days, "2026-01-02", "7");
    expect(series).toHaveLength(7);
    expect(series[0].key).toBe("2025-12-27");
    expect(series[series.length - 1]).toEqual({
      key: "2026-01-02",
      label: "2",
      title: "1月2日",
      chars: 0,
    });
    expect(series.find((point) => point.key === "2026-01-01")?.chars).toBe(50);
  });

  it("按月 = 近 12 个月合计柱", () => {
    const series = trendSeries(days, "2026-11-15", "month");
    expect(series).toHaveLength(WRITING_TREND_MONTHS);
    expect(series[0]).toMatchObject({ key: "2025-12-01", label: "12月", chars: 100 });
    expect(series.find((point) => point.key === "2026-02-01")?.chars).toBe(200);
    expect(series[series.length - 1]).toMatchObject({ key: "2026-11-01", chars: 300 });
    expect(series.find((point) => point.key === "2026-01-01")?.chars).toBe(50);
  });

  it("合计 / 日均（含 0 字日、四舍五入）/ 最高", () => {
    expect(summarizeChars([10, 0, 5])).toEqual({ total: 15, average: 5, max: 10 });
    expect(summarizeChars([1, 0])).toEqual({ total: 1, average: 1, max: 1 });
    expect(summarizeChars([])).toEqual({ total: 0, average: 0, max: 0 });
  });

  it("千分位", () => {
    expect(formatChars(0)).toBe("0");
    expect(formatChars(999)).toBe("999");
    expect(formatChars(1000)).toBe("1,000");
    expect(formatChars(1234567)).toBe("1,234,567");
  });
});

describe("热力档位（阈值只取 WRITING_HEAT_THRESHOLDS）", () => {
  it("0 + 4 正档，边界逐档命中", () => {
    expect(writingHeatLevel(0)).toBe(0);
    expect(writingHeatLevel(-10)).toBe(0);
    for (let index = 0; index < WRITING_HEAT_THRESHOLDS.length; index += 1) {
      const threshold = WRITING_HEAT_THRESHOLDS[index];
      const next = WRITING_HEAT_THRESHOLDS[index + 1];
      expect(writingHeatLevel(threshold), String(threshold)).toBe(index + 1);
      expect(writingHeatLevel(threshold - 1), String(threshold - 1)).toBe(index);
      if (next !== undefined) expect(writingHeatLevel(next - 1), String(next - 1)).toBe(index + 1);
    }
    expect(writingHeatLevel(999999)).toBe(4);
  });
});

describe("年热力网格（53 列 × 7 行、周一起始、近 365 天）", () => {
  it("窗口 = today 往前 364 天（含首尾）", () => {
    expect(heatmapWindow("2026-11-15")).toEqual({ from: "2025-11-16", to: "2026-11-15" });
  });

  it("任何星期几的 today 都恰好 53 列、365 个日期、最后一天 = today", () => {
    for (const today of ["2026-11-15", "2026-11-12", "2026-11-09", "2026-11-16"]) {
      const weeks = heatmapWeeks(today);
      expect(weeks, today).toHaveLength(WRITING_HEATMAP_WEEKS);
      expect(weeks.every((week) => week.length === 7), today).toBe(true);
      const dates = weeks.flat().filter((cell): cell is string => cell !== null);
      expect(dates, today).toHaveLength(WRITING_HEATMAP_DAYS);
      expect(dates[0], today).toBe(heatmapWindow(today).from);
      expect(dates[dates.length - 1], today).toBe(today);
    }
  });

  it("首列周一、末列周日（每列 = 一周）", () => {
    const weeks = heatmapWeeks("2026-11-15");
    const first = weeks[0].find((cell): cell is string => cell !== null);
    expect(first).toBe("2025-11-16");
    expect(weekdayIndex(first as string)).toBe(6); // 先补周日；窗口首日前 6 格为空
    expect(weeks[0].slice(0, 6).every((cell) => cell === null)).toBe(true);
  });
});

describe("页面容器查询阈值与类字面量同值（阈值单源）", () => {
  it("WritingStats.tsx 用同一常量的类字面量，且查询挂在 @container 上", () => {
    const source = readFileSync(new URL("../pages/WritingStats.tsx", import.meta.url), "utf8");
    expect(source).toContain("@container");
    expect(source).toContain(`@min-[${STATS_TWO_COLUMN_MIN_WIDTH}px]`);
  });
});