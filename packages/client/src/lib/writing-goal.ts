// 每日目标与连续天数的纯函数（口径 = docs/api/130-api-writing-stats.md「每日目标与连续天数」；
// 偏好形状与 key = docs/design/config.md；页面形态 = docs/ui/DESIGN.md「今日目标」）。
//
// 四条硬口径（组件不得另写一遍）：
// ① 档位表只有 `WRITING_GOAL_PRESETS` 一处：它就是热力阈值去掉「有记录」那一档，不出现数字字面量；
// ② 日字数只来自服务端 `days[]` + `today`，**本模块不生成「今天」**（日键权威值 = `WritingStatsRes.today`）；
// ③ 连续天数**严格连续**：从 `today` 往前逐日回退遇未达标即止；写作日（`writingDays`，0 = 周一 … 6 = 周日）
//    之外的日子既不要求也不中断；空勾选按全勾处理；
// ④ `today` 尚未达标**不算断签**（此时显示截至昨天的天数）。
// 偏好是本机展示层数据（localStorage，按书隔离）：不进 data.db / 备份 / 导出 / 云端。
import {
  addDays,
  charsByDate,
  weekdayIndex,
  WRITING_HEAT_THRESHOLDS,
  WRITING_STATS_WEEKDAYS,
  type WritingStatsDay,
} from "./writing-stats";

/**
 * 目标档位（Segmented 的取值单源）：热力阈值去掉首档（首档 = 「有任何记录」，不是日目标）。
 * 首项因此恒等于 `WRITING_HEAT_THRESHOLDS[1]`——缺省目标与热力第二档同值，不另写数字。
 */
export const WRITING_GOAL_PRESETS: readonly number[] = WRITING_HEAT_THRESHOLDS.slice(1);

/** 写作日全集（0 = 周一 … 6 = 周日，与 `weekdayIndex` 同口径；与星期表头同源） */
export const WRITING_WEEKDAY_INDEXES: readonly number[] = WRITING_STATS_WEEKDAYS.map(
  (_, index) => index,
);

export interface WritingGoalPreference {
  /** 日目标字数（正有限数） */
  goal: number;
  /** 关闭后任何面都不渲染进度与连续天数 */
  enabled: boolean;
  /** 计入连续天数的写作日周序号；空集合按全勾处理 */
  writingDays: number[];
}

/** 缺省偏好 = 首档 + 开启 + 全勾（工厂而非常量：`writingDays` 数组不共享给调用方） */
export function defaultWritingGoalPreference(): WritingGoalPreference {
  return {
    goal: WRITING_GOAL_PRESETS[0],
    enabled: true,
    writingDays: [...WRITING_WEEKDAY_INDEXES],
  };
}

/** localStorage key 前缀（按书隔离：`ai-editor:writing-goal:{projectId}`） */
const WRITING_GOAL_STORAGE_PREFIX = "ai-editor:writing-goal:";

/** localStorage key；无打开项目 = `null`（没有可归属的书 ⇒ 不落盘） */
export function writingGoalStorageKey(projectId: string | null): string | null {
  return projectId === null ? null : `${WRITING_GOAL_STORAGE_PREFIX}${projectId}`;
}

/** 写作日归一：合法 = 0–6 的整数且不重复；空数组合法（= 全勾）；其余一律 `null`（调用处回落缺省） */
function normalizeWritingDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const days = new Set<number>();
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) return null;
    if (item < 0 || item > WRITING_WEEKDAY_INDEXES.length - 1) return null;
    if (days.has(item)) return null;
    days.add(item);
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * 解析持久化偏好（localStorage 防御，**也是写回前的归一入口**）：
 * 坏 JSON / 非对象 / 缺字段 / 非有限或 `goal <= 0` / 非法或重复周序号 → 整体回落缺省，不抛。
 * 未知键忽略；`writingDays` 落成升序去重的副本。
 */
export function parseWritingGoalPreference(raw: string | null): WritingGoalPreference {
  if (!raw) return defaultWritingGoalPreference();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultWritingGoalPreference();
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return defaultWritingGoalPreference();
  const rec = data as Record<string, unknown>;
  const goal = rec.goal;
  const writingDays = normalizeWritingDays(rec.writingDays);
  if (typeof goal !== "number" || !Number.isFinite(goal) || goal <= 0)
    return defaultWritingGoalPreference();
  if (typeof rec.enabled !== "boolean" || writingDays === null) return defaultWritingGoalPreference();
  return { goal, enabled: rec.enabled, writingDays };
}

export interface GoalProgress {
  /** 当日字数（`days` 无该日 = 0） */
  chars: number;
  reached: boolean;
}

/** 今日进度：当日字数与是否达标（`days` 只含正增量 ⇒ 删除不扣减，不另加判定） */
export function goalProgress(
  days: readonly WritingStatsDay[],
  today: string,
  goal: number,
): GoalProgress {
  const chars = charsByDate(days).get(today) ?? 0;
  return { chars, reached: chars >= goal };
}

/**
 * 连续达标天数：从 `today` 往前逐日回退。
 * - 未勾的写作日：跳过（既不要求也不中断，也不计入天数）；
 * - `today` 未达标：跳过（不算断签）——再往前的日子照常判定；
 * - 其他写作日未达标：终止。
 * `writingDays` 空集合按全勾处理；回退下限 = `days` 最早日期（早于数据的日子一律视为未达标）。
 */
export function currentStreak(
  days: readonly WritingStatsDay[],
  today: string,
  goal: number,
  writingDays: readonly number[],
): number {
  if (days.length === 0) return 0;
  const chars = charsByDate(days);
  const required = new Set(writingDays.length === 0 ? WRITING_WEEKDAY_INDEXES : writingDays);
  const earliest = days.reduce((min, entry) => (entry.date < min ? entry.date : min), days[0].date);
  let streak = 0;
  for (let key = today; key >= earliest; key = addDays(key, -1)) {
    if (!required.has(weekdayIndex(key))) continue;
    if ((chars.get(key) ?? 0) >= goal) streak += 1;
    else if (key !== today) break;
  }
  return streak;
}
