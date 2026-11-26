// 每日目标与连续天数纯函数单测（口径 = docs/api/130-api-writing-stats.md「每日目标与连续天数」）。
// 覆盖：档位/缺省/存储 key、坏偏好回落、今日进度、连续天数（断日 / 跨月 / 跨年 / 闰日 /
// 未勾写作日 / 今天未达标 / 空 days / 空写作日）。
import { describe, expect, it } from "vitest";
import {
  currentStreak,
  defaultWritingGoalPreference,
  goalProgress,
  parseWritingGoalPreference,
  WRITING_GOAL_PRESETS,
  WRITING_WEEKDAY_INDEXES,
  writingGoalStorageKey,
} from "./writing-goal";
import { WRITING_HEAT_THRESHOLDS, WRITING_STATS_WEEKDAYS } from "./writing-stats";

const day = (date: string, chars: number) => ({ date, chars });
const GOAL = WRITING_HEAT_THRESHOLDS[1];
const ALL_DAYS = WRITING_WEEKDAY_INDEXES;

describe("目标档位与缺省偏好", () => {
  it("档位表 = 热力阈值去掉首档（首项与热力第二档同值，不写数字字面量）", () => {
    expect(WRITING_GOAL_PRESETS[0]).toBe(WRITING_HEAT_THRESHOLDS[1]);
    expect(WRITING_GOAL_PRESETS).toEqual(WRITING_HEAT_THRESHOLDS.slice(1));
  });

  it("写作日全集与星期表头同长（0 = 周一 … 6 = 周日）", () => {
    expect(WRITING_WEEKDAY_INDEXES).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(WRITING_WEEKDAY_INDEXES).toHaveLength(WRITING_STATS_WEEKDAYS.length);
  });

  it("缺省 = 首档 + 开启 + 全勾，且每次给独立数组", () => {
    const preference = defaultWritingGoalPreference();
    expect(preference).toEqual({ goal: GOAL, enabled: true, writingDays: [0, 1, 2, 3, 4, 5, 6] });
    preference.writingDays.push(9);
    expect(defaultWritingGoalPreference().writingDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("存储 key 按书隔离；无打开项目 = null", () => {
    expect(writingGoalStorageKey("book-1")).toBe("ai-editor:writing-goal:book-1");
    expect(writingGoalStorageKey("book-2")).not.toBe(writingGoalStorageKey("book-1"));
    expect(writingGoalStorageKey(null)).toBeNull();
  });
});

describe("解析持久化偏好（归一入口）", () => {
  const fallback = () => defaultWritingGoalPreference();

  it("空值 / 坏 JSON / 非对象 → 缺省", () => {
    expect(parseWritingGoalPreference(null)).toEqual(fallback());
    expect(parseWritingGoalPreference("")).toEqual(fallback());
    expect(parseWritingGoalPreference("{oops")).toEqual(fallback());
    expect(parseWritingGoalPreference("null")).toEqual(fallback());
    expect(parseWritingGoalPreference("[]")).toEqual(fallback());
    expect(parseWritingGoalPreference("42")).toEqual(fallback());
  });

  it("缺字段 → 缺省", () => {
    expect(parseWritingGoalPreference(JSON.stringify({ goal: 300 }))).toEqual(fallback());
    expect(parseWritingGoalPreference(JSON.stringify({ goal: 300, enabled: true }))).toEqual(
      fallback(),
    );
    expect(parseWritingGoalPreference(JSON.stringify({ enabled: true, writingDays: [] }))).toEqual(
      fallback(),
    );
  });

  it("goal 非有限 / 不大于 0 / 非数值 → 缺省", () => {
    for (const goal of [0, -200, 1e999, "200", null]) {
      expect(
        parseWritingGoalPreference(JSON.stringify({ goal, enabled: true, writingDays: [] })),
      ).toEqual(fallback());
    }
  });

  it("非法 / 越界 / 重复的周序号 → 缺省", () => {
    for (const writingDays of [7, -1, [1.5], ["1"], [0, 0], [0, 7], "0,1"]) {
      expect(
        parseWritingGoalPreference(JSON.stringify({ goal: 300, enabled: true, writingDays })),
      ).toEqual(fallback());
    }
  });

  it("合法值保留：空写作日合法（= 全勾），周序号升序去重，未知键忽略", () => {
    expect(
      parseWritingGoalPreference(
        JSON.stringify({ goal: 300, enabled: false, writingDays: [], extra: "ignored" }),
      ),
    ).toEqual({ goal: 300, enabled: false, writingDays: [] });
    expect(
      parseWritingGoalPreference(JSON.stringify({ goal: 300, enabled: true, writingDays: [5, 0] })),
    ).toEqual({ goal: 300, enabled: true, writingDays: [0, 5] });
  });
});

describe("今日进度", () => {
  const days = [day("2026-11-15", 400), day("2026-11-16", GOAL)];

  it("达到目标（含恰好相等）→ reached", () => {
    expect(goalProgress(days, "2026-11-16", GOAL)).toEqual({ chars: GOAL, reached: true });
    expect(goalProgress([day("2026-11-16", GOAL + 1)], "2026-11-16", GOAL)).toEqual({
      chars: GOAL + 1,
      reached: true,
    });
  });

  it("未达标 / 当日无行 → 0 字未达标；往日的字不借给今日", () => {
    expect(goalProgress([day("2026-11-16", GOAL - 1)], "2026-11-16", GOAL)).toEqual({
      chars: GOAL - 1,
      reached: false,
    });
    expect(goalProgress(days, "2026-11-17", GOAL)).toEqual({ chars: 0, reached: false });
    expect(goalProgress([], "2026-11-16", GOAL)).toEqual({ chars: 0, reached: false });
  });
});

describe("连续天数", () => {
  it("严格连续：今天起逐日达标全计数，遇未达标即止", () => {
    const days = [
      day("2026-11-12", GOAL + 500), // 更早的达标日：被 11-13 这个断日隔开，不计
      day("2026-11-14", GOAL),
      day("2026-11-15", GOAL),
      day("2026-11-16", GOAL),
    ];
    expect(currentStreak(days, "2026-11-16", GOAL, ALL_DAYS)).toBe(3);
  });

  it("断日：昨天无行 → 只算今天", () => {
    expect(currentStreak([day("2026-11-16", GOAL)], "2026-11-16", GOAL, ALL_DAYS)).toBe(1);
  });

  it("跨月：跨 3 月 1 日回退", () => {
    const days = [day("2024-02-28", GOAL), day("2024-02-29", GOAL), day("2024-03-01", GOAL)];
    expect(currentStreak(days, "2024-03-01", GOAL, ALL_DAYS)).toBe(3);
  });

  it("闰日：2 月 29 日在链上；非闰年 2 月 28 日直接接 3 月 1 日", () => {
    expect(
      currentStreak(
        [day("2024-02-29", GOAL), day("2024-03-01", GOAL)],
        "2024-03-01",
        GOAL,
        ALL_DAYS,
      ),
    ).toBe(2);
    expect(
      currentStreak(
        [day("2025-02-28", GOAL), day("2025-03-01", GOAL)],
        "2025-03-01",
        GOAL,
        ALL_DAYS,
      ),
    ).toBe(2);
  });

  it("跨年：12 月 31 日接 1 月 1 日", () => {
    const days = [day("2025-12-30", GOAL), day("2025-12-31", GOAL), day("2026-01-01", GOAL)];
    expect(currentStreak(days, "2026-01-01", GOAL, ALL_DAYS)).toBe(3);
  });

  it("未勾写作日：既不要求也不中断，也不计入天数（未勾而达标的日子照样不算）", () => {
    // 写作日只勾周一 / 周三；2026-11-16 = 周一、11-11 = 周三、11-09 = 周一、11-04 = 周三（缺行 → 断签）
    const days = [
      day("2026-11-02", 500), // 周一达标，但被 11-04 的缺行隔开
      day("2026-11-09", GOAL),
      day("2026-11-11", GOAL),
      day("2026-11-15", GOAL + 700), // 周日未勾：达标也不计入
      day("2026-11-16", GOAL),
    ];
    expect(currentStreak(days, "2026-11-16", GOAL, [0, 2])).toBe(3);
  });

  it("今天未达标不算断签（显示截至昨天的天数）", () => {
    const days = [day("2026-11-14", GOAL), day("2026-11-15", GOAL), day("2026-11-16", 0)];
    expect(currentStreak(days, "2026-11-16", GOAL, ALL_DAYS)).toBe(2);
    expect(currentStreak([day("2026-11-15", GOAL)], "2026-11-16", GOAL, ALL_DAYS)).toBe(1);
  });

  it("今天未达标且昨天也未达标 → 0", () => {
    expect(currentStreak([day("2026-11-14", GOAL)], "2026-11-16", GOAL, ALL_DAYS)).toBe(0);
  });

  it("空 days → 0", () => {
    expect(currentStreak([], "2026-11-16", GOAL, ALL_DAYS)).toBe(0);
    expect(currentStreak([], "2026-11-16", GOAL, [])).toBe(0);
  });

  it("空写作日集合按全勾处理", () => {
    const days = [day("2026-11-14", GOAL), day("2026-11-15", GOAL), day("2026-11-16", GOAL)];
    expect(currentStreak(days, "2026-11-16", GOAL, [])).toBe(
      currentStreak(days, "2026-11-16", GOAL, ALL_DAYS),
    );
    expect(currentStreak([day("2026-11-14", GOAL)], "2026-11-16", GOAL, [])).toBe(0);
  });
});
