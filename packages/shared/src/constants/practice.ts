// 文风仿写练习上限常量（2026-10）——唯一定义处
//
// 数值单源（AGENTS「数值单源」）：REST schema（`docs/api/120-api-practice.md`）与
// 工具说明插值（卡 6）一律取这里，禁止在 schema 注释/散文/工具描述里复述数字。
// 字段语义见 `docs/db/schema.md`「practice_targets / practice_samples」与
// `docs/design/60-practice.md` §3。
// 长度口径 = JS 字符串长度（UTF-16 code unit），与既有文本分页常量同源。

/**
 * 文风目标名（`practice_targets.name`）长度上限——工具结果里 `target_name` 是信封字段，
 * 不设上限时超长名会把内层续读提示挤出单条工具结果预算（`tools/query/practice.ts` 头注释实测）。
 */
export const MAX_PRACTICE_TARGET_NAME_CHARS = 100;

/** 用户观察到的文风特点（`practice_targets.observation`）长度上限 */
export const MAX_PRACTICE_OBSERVATION_CHARS = 500;

/** 范文来源说明（`practice_samples.source_label`）长度上限 */
export const MAX_PRACTICE_SOURCE_LABEL_CHARS = 100;

/** 范文快照（`practice_samples.text`）长度上限 */
export const MAX_PRACTICE_SAMPLE_CHARS = 20000;

/** 用户仿写稿（`practice_samples.draft`）长度上限 */
export const MAX_PRACTICE_DRAFT_CHARS = 20000;

/** 点评卡维度数上限（`feedback.dimensions[]`；工具说明由该常量插值生成） */
export const MAX_FEEDBACK_DIMENSIONS = 6;
