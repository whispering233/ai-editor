// 会话累计口径（`lib/writing-session.ts`）：负增量不扣、空闲超阈值不计时、精确边界、
// 显示尾段、速率窗口与格式化。契约 = DESIGN.md「当日码字悬浮面板」→「指标计算」。
import { describe, expect, it } from "vitest";
import {
  applyActivity,
  formatDuration,
  formatRate,
  MIN_RATE_WINDOW_MS,
  TYPING_ACTIVE_GAP_MS,
  type WritingSessionNumbers,
} from "./writing-session";

const idle: WritingSessionNumbers = { chars: 0, typingMs: 0, lastEditAt: null };

describe("applyActivity", () => {
  it("正增量计入字数；首次变更（无上次时刻）不计码字时间", () => {
    const state = applyActivity(idle, 12, 1_000);
    expect(state).toEqual({ chars: 12, typingMs: 0, lastEditAt: 1_000 });
  });

  it("负增量不扣字数，但仍推进最后变更时刻（删除也重置空闲时间）", () => {
    const state = applyActivity({ chars: 120, typingMs: 2_000, lastEditAt: 1_000 }, -30, 4_000);
    expect(state.chars).toBe(120);
    expect(state.lastEditAt).toBe(4_000);
    expect(state.typingMs).toBe(5_000); // 原 2000 + 间隔 3000（≤ 阈值）
  });

  it("间隔超阈值不计入码字时间（离开后重新起算）", () => {
    const state = applyActivity(
      { chars: 10, typingMs: 500, lastEditAt: 1_000 },
      1,
      1_000 + TYPING_ACTIVE_GAP_MS + 1,
    );
    expect(state.typingMs).toBe(500);
  });

  it("精确边界：间隔 = 阈值计入，阈值 + 1 不计", () => {
    const atThreshold = applyActivity(
      { chars: 10, typingMs: 500, lastEditAt: 1_000 },
      1,
      1_000 + TYPING_ACTIVE_GAP_MS,
    );
    expect(atThreshold.typingMs).toBe(500 + TYPING_ACTIVE_GAP_MS);
  });

  it("时钟回拨（now 小于上次时刻）不计负间隔", () => {
    const state = applyActivity({ chars: 5, typingMs: 700, lastEditAt: 2_000 }, 1, 1_500);
    expect(state.typingMs).toBe(700);
  });
});

describe("formatRate", () => {
  it("窗口短于阈值 → —（含恰好差 1ms）", () => {
    expect(formatRate(100, MIN_RATE_WINDOW_MS - 1)).toBe("—");
  });

  it("窗口 = 阈值即可算，四舍五入 + 千分位", () => {
    // 10 字 / (5000ms = 1/720 小时) = 7200 字/时
    expect(formatRate(10, MIN_RATE_WINDOW_MS)).toBe("7,200");
    expect(formatRate(1_234, 3_600_000)).toBe("1,234");
    expect(formatRate(0, 60_000)).toBe("0");
  });
});

describe("formatDuration", () => {
  it("HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(61_000)).toBe("00:01:01");
    expect(formatDuration(3_661_000)).toBe("01:01:01");
    expect(formatDuration(100 * 3_600_000)).toBe("100:00:00");
  });

  it("负数按 0（时钟回拨不出现负时长）", () => {
    expect(formatDuration(-5_000)).toBe("00:00:00");
  });
});