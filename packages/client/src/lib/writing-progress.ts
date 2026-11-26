// 写作页卷章导航栏的「今日目标元信息行」纯函数（形态 = docs/ui/DESIGN.md `writing-page`
// 「卷章导航栏 · 今日目标元信息行」；口径 = docs/api/130-api-writing-stats.md「每日目标与连续天数」）。
//
// 两个职责，组件不另写一遍：
// ① 刷新节流：本页是该端点的第二个消费点，触发点只有「进页一次 + 保存成功后过节流窗口」，
//    窗口就在这里定义一次。**基准只算「保存触发的刷新」**：进页那次请求不占窗口（否则进页
//    60s 内的保存全被吞），页面侧调 `shouldRefreshProgress` 判定是否 bump tick，不新增定时器；
// ② 一行文案派生：今日字数 / 目标 / 连续天数全部来自 `lib/writing-goal.ts` 的既有函数，
//    **不做**「服务端 today + 客户端本次增量」相加（双口径混算，DESIGN 明写禁止）。
import type { WritingStatsRes } from "@whispering233/ai-editor-shared";
import { currentStreak, goalProgress, type WritingGoalPreference } from "./writing-goal";
import { formatChars } from "./writing-stats";

/** 保存后刷新今日目标行的最小间隔（ms）：窗口内的连续保存只保留第一次触发 */
export const WRITING_PROGRESS_REFRESH_MS = 60_000;

/**
 * 该不该为这次保存刷新：`lastRefreshAt` = 上一次**保存触发**刷新的时刻（进页那次不算）；
 * 从未因保存刷新过（或本轮首次保存）→ 恒刷新。
 */
export function shouldRefreshProgress(lastRefreshAt: number | null, now: number): boolean {
  return lastRefreshAt === null || now - lastRefreshAt >= WRITING_PROGRESS_REFRESH_MS;
}

export interface WritingProgressMeta {
  /** 一行文案（不含颜色与 `✓`：达标态由渲染侧换主色 + 补标记） */
  text: string;
  /** 今日是否达标 */
  reached: boolean;
}

/**
 * 元信息行文案：`今日 {已写} / {目标} 字 · 连续 {N} 天`。
 * 四种不渲染情形都归到这个 `null`：未打开项目 / 拉取失败（`stats` 为 `null`）、目标关闭、
 * 无数据（`days` 为空）——渲染侧只在拿到非 `null` 时传 `meta`，不留空占位。
 */
export function writingProgressMeta(
  stats: WritingStatsRes | null,
  preference: WritingGoalPreference,
): WritingProgressMeta | null {
  if (stats === null || !preference.enabled || stats.days.length === 0) return null;
  const progress = goalProgress(stats.days, stats.today, preference.goal);
  const streak = currentStreak(stats.days, stats.today, preference.goal, preference.writingDays);
  return {
    text: `今日 ${formatChars(progress.chars)} / ${formatChars(preference.goal)} 字 · 连续 ${streak} 天`,
    reached: progress.reached,
  };
}
