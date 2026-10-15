// 文风练习上限常量（2026-10 改版）——唯一定义处
//
// 数值单源（AGENTS「数值单源」）：REST schema（`docs/api/120-api-practice.md`）与
// 工具说明插值一律取这里，禁止在 schema 注释 / 散文 / 工具描述里复述数字。
// 字段语义见 `docs/db/schema.md`「练习三表」与 `docs/design/60-practice.md` §3 / §5。
// 长度口径 = JS 字符串长度（UTF-16 code unit），与既有文本分页常量同源。

/** 片段说明（`practice_samples.excerpt_label`）长度上限 */
export const MAX_PRACTICE_EXCERPT_LABEL_CHARS = 100;

/** 范文快照（`practice_samples.text`）长度上限——样本是整篇范文，不是节选 */
export const MAX_PRACTICE_SAMPLE_CHARS = 100000;

/** 用户稿件长度上限：仿写稿与自由练习稿（`practice_samples.draft` / `practice_free_pieces.draft`）共用 */
export const MAX_PRACTICE_DRAFT_CHARS = 20000;

/** 自由练习题目（`practice_free_pieces.topic`）长度上限 */
export const MAX_PRACTICE_TOPIC_CHARS = 100;

/** 自由练习写作要求（`practice_free_pieces.brief`）长度上限 */
export const MAX_PRACTICE_BRIEF_CHARS = 500;

/** 风格说明素材包（`practice_style_packs.content`）长度上限——存的是整份风格说明，按长文留足 */
export const MAX_PRACTICE_STYLE_PACK_CHARS = 100000;

/** 点评卡维度数上限（`feedback.dimensions[]`；工具说明由该常量插值生成） */
export const MAX_FEEDBACK_DIMENSIONS = 6;