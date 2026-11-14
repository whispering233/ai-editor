// 当日码字悬浮面板的会话累计口径（纯函数，单测覆盖；DESIGN.md「当日码字悬浮面板」）。
// 数字只在客户端内存：不进 data.db、不进备份 / 云端 / 导出，刷新即清零。
import { formatChars } from "./writing-stats";

/** 相邻两次变更的间隔 ≤ 此值才计入码字时间（更长 = 中途离开，下一段重新起算） */
export const TYPING_ACTIVE_GAP_MS = 10_000;
/** 码字时间窗口下限：短于此值不显示速率（样本太少，速率会被一两次快速输入放大到无意义） */
export const MIN_RATE_WINDOW_MS = 5_000;

export interface WritingSessionNumbers {
  /** 本次码字（只加正向文本增量，删除不扣） */
  chars: number;
  /** 码字时间（相邻变更间隔的累计，秒级展示） */
  typingMs: number;
  /** 最后变更时刻（ms；null = 本次尚无编辑） */
  lastEditAt: number | null;
}

/** 记一次编辑器变更：正增量计字数；间隔未超阈值时把该间隔计入码字时间 */
export function applyActivity(
  state: WritingSessionNumbers,
  delta: number,
  now: number,
): WritingSessionNumbers {
  const gap = state.lastEditAt === null ? null : now - state.lastEditAt;
  const typingMs =
    gap !== null && gap >= 0 && gap <= TYPING_ACTIVE_GAP_MS ? state.typingMs + gap : state.typingMs;
  return { chars: state.chars + Math.max(0, delta), typingMs, lastEditAt: now };
}

/** `HH:MM:SS`（负数按 0 处理；小时可超过两位） */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(
    totalSeconds % 60,
  )}`;
}

/** 码字速率（字/时，四舍五入 + 千分位）；窗口过短时给 `—` */
export function formatRate(chars: number, typingMs: number): string {
  if (typingMs < MIN_RATE_WINDOW_MS) return "—";
  return formatChars(Math.round(chars / (typingMs / 3_600_000)));
}