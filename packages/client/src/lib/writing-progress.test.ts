// 今日目标元信息行纯函数单测（DESIGN.md `writing-page`「卷章导航栏 · 今日目标元信息行」/
// 130-api-writing-stats.md「每日目标与连续天数」）。
// 覆盖：节流窗口边界（从未因保存刷新 / 窗口内 / 恰到窗口）与文案派生（达标 / 未达标 / 目标关闭 / 无数据）。
import { describe, expect, it } from "vitest";
import type { WritingStatsRes } from "@whispering233/ai-editor-shared";
import { defaultWritingGoalPreference, WRITING_GOAL_PRESETS } from "./writing-goal";
import {
  shouldRefreshProgress,
  WRITING_PROGRESS_REFRESH_MS,
  writingProgressMeta,
} from "./writing-progress";
import { WRITING_HEAT_THRESHOLDS } from "./writing-stats";

const TODAY = "2026-11-16";
const GOAL = WRITING_HEAT_THRESHOLDS[1];

function stats(days: Array<{ date: string; chars: number }>): WritingStatsRes {
  return {
    today: TODAY,
    totalChars: days.reduce((sum, entry) => sum + entry.chars, 0),
    totalDays: days.length,
    days,
  };
}

const preference = (patch: Partial<ReturnType<typeof defaultWritingGoalPreference>> = {}) => ({
  ...defaultWritingGoalPreference(),
  goal: GOAL,
  ...patch,
});

describe("刷新节流", () => {
  it("从未拉过 → 刷新", () => {
    expect(shouldRefreshProgress(null, 1_000)).toBe(true);
  });

  it("窗口内 → 不刷新（含窗口前一毫秒）；恰到窗口 → 刷新", () => {
    const last = 10_000;
    expect(shouldRefreshProgress(last, last)).toBe(false);
    expect(shouldRefreshProgress(last, last + WRITING_PROGRESS_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshProgress(last, last + WRITING_PROGRESS_REFRESH_MS)).toBe(true);
    expect(shouldRefreshProgress(last, last + WRITING_PROGRESS_REFRESH_MS * 3)).toBe(true);
  });

  it("时钟回拨（now 早于上次）按窗口内处理", () => {
    expect(shouldRefreshProgress(10_000, 9_000)).toBe(false);
  });
});

describe("元信息行文案", () => {
  it("未达标 → 今日已写 / 目标 + 连续天数，reached = false", () => {
    expect(writingProgressMeta(stats([{ date: TODAY, chars: GOAL - 1 }]), preference())).toEqual({
      text: `今日 ${GOAL - 1} / ${GOAL} 字 · 连续 0 天`,
      reached: false,
    });
  });

  it("恰好达标 → reached，连续天数从今天算起", () => {
    const days = [
      { date: "2026-11-14", chars: GOAL },
      { date: "2026-11-15", chars: GOAL },
      { date: TODAY, chars: GOAL },
    ];
    expect(writingProgressMeta(stats(days), preference())).toEqual({
      text: `今日 ${GOAL} / ${GOAL} 字 · 连续 3 天`,
      reached: true,
    });
  });

  it("数字走 formatChars（千分位），目标与字数同源格式化", () => {
    const goal = WRITING_GOAL_PRESETS[WRITING_GOAL_PRESETS.length - 1];
    const meta = writingProgressMeta(stats([{ date: TODAY, chars: 1234 }]), preference({ goal }));
    // goal 末档 = 1000（`WRITING_HEAT_THRESHOLDS` 末项），字面量断言千分位（不依赖 ICU）
    expect(meta?.text).toBe("今日 1,234 / 1,000 字 · 连续 1 天");
  });

  it("目标关闭 → null（整行不渲染）", () => {
    expect(
      writingProgressMeta(stats([{ date: TODAY, chars: GOAL }]), preference({ enabled: false })),
    ).toBeNull();
  });

  it("无数据（days 为空）→ null", () => {
    expect(writingProgressMeta(stats([]), preference())).toBeNull();
  });

  it("未打开项目 / 拉取失败（数据为 null）→ null", () => {
    expect(writingProgressMeta(null, preference())).toBeNull();
  });
});
