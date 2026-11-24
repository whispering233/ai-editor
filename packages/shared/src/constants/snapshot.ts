// 章级历史快照的策略常量（2026-11）——唯一定义处
//
// 数值单源（AGENTS「数值单源」）：服务端保存钩子（`server/src/routes/manuscript.ts`）与裁剪
// （`db/src/queries/document-snapshots.ts`）一律取这里；文档（`docs/db/schema.md`
// 「document_snapshots」、`docs/api/110-api-manuscript.md`「章级历史」）引用常量名，不复述数字。
// 语义：快照记「被覆盖的旧内容」，节流与去重都在服务端判定（客户端零改动）。

/** 同一章两份快照的最小间隔（毫秒）——距该章最后一份 `created_at` 不足该间隔则保存不压快照 */
export const CHAPTER_SNAPSHOT_MIN_INTERVAL_MS = 60_000;

/** 单章快照份数上限（超出从最旧删）——防一章独占全局预算 */
export const MAX_SNAPSHOTS_PER_DOCUMENT = 4;

/** 全局预算倍数：全书快照字数上限 = 该书正文总量 × 该倍数（超出从最旧删，与每章上限同时生效） */
export const SNAPSHOT_BUDGET_MULTIPLIER = 4;