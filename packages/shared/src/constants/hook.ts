// 伏笔（Hook）系统常量

/** 伏笔状态枚举（：planted → progressing → resolved 或 abandoned） */
export const HOOK_STATUSES = ["planted", "progressing", "resolved", "abandoned"] as const;

/** 伏笔状态 */
export type HookStatus = (typeof HOOK_STATUSES)[number];

/** 回收节奏枚举（ payoff_timing） */
export const PAYOFF_TIMING = [
  "immediate",
  "near_term",
  "mid_arc",
  "slow_burn",
  "endgame",
] as const;

/** 回收节奏 */
export type PayoffTiming = (typeof PAYOFF_TIMING)[number];

/**
 * half_life 缺省映射（单位：章）
 * 显式 half_life 优先；未设置时按 payoff_timing 取此映射默认值。
 * immediate=3 / near_term=8 / mid_arc=15 / slow_burn=25 / endgame=40
 */
export const DEFAULT_HALF_LIFE: Record<PayoffTiming, number> = {
  immediate: 3,
  near_term: 8,
  mid_arc: 15,
  slow_burn: 25,
  endgame: 40,
};

/**
 * 伏笔分类建议值（：category 自由填，本常量仅为前端选择器建议值，非校验约束）
 */
export const HOOK_CATEGORIES = [
  "mystery",
  "relationship",
  "item",
  "character_growth",
  "world_building",
] as const;

/** 伏笔分类（建议值） */
export type HookCategory = (typeof HOOK_CATEGORIES)[number];
