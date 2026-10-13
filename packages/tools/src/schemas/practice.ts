// 工具参数 schema：文风仿写练习域（get_practice_sample / get_practice_draft / submit_style_feedback）
//
// 口径见 docs/api/tool-calling.md「练习（2026-10）」与 docs/design/60-practice.md §4/§5：
// 两个只读工具按 offset / max_chars 分页（缺省与上限 = `query/manuscript.ts` 的
// `DEFAULT_TEXT_PAGE_CHARS` / `MAX_TEXT_PAGE_CHARS`，与 get_chapter_text 同一对常量）；
// 提交工具的卡内层字段恒 snake_case（同 shared `practiceFeedbackSchema` / FeedbackCard）。

import { Type, type Static } from "@earendil-works/pi-ai";

/**
 * 练习文本分页入参（get_practice_sample 与 get_practice_draft **同形**：都读样本里的一段文本）：
 * sample_id 必填（ps-*）；offset 为起始字符下标（缺省 0）；max_chars 为本次最多返回字符数
 * （缺省与上限见 `query/manuscript.ts` 的两个分页常量——实现层 clamp）。
 */
export const practiceTextPageArgsSchema = Type.Object(
  {
    sample_id: Type.String(),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    max_chars: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export type PracticeTextPageArgs = Static<typeof practiceTextPageArgsSchema>;

/**
 * 维度（点评卡的一项）：维度名 + 范文/稿件特征 + 证据引用 + 可执行建议——字段与
 * shared `practiceFeedbackSchema` 的 `dimensions[]` 同形（snake_case，勿转换）。
 * 引用数组**可省**（省 = 无证据）；落库卡恒有数组（实现层补 `[]`，读取侧形状完整）。
 */
const feedbackDimensionSchema = Type.Object(
  {
    name: Type.String(),
    sample_trait: Type.String(),
    draft_trait: Type.String(),
    sample_quotes: Type.Optional(Type.Array(Type.String())),
    draft_quotes: Type.Optional(Type.Array(Type.String())),
    advice: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * submit_style_feedback 入参：sample_id + dimensions（**上限 = shared `MAX_FEEDBACK_DIMENSIONS`**，
 * 实现层校验——工具描述由该常量插值生成）+ summary（可选一句话总评）。
 * **没有「示范」字段**：卡片只做诊断，没有位置放成段文字（docs/design/60-practice.md §4）。
 */
export const submitStyleFeedbackArgsSchema = Type.Object(
  {
    sample_id: Type.String(),
    dimensions: Type.Array(feedbackDimensionSchema),
    summary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type SubmitStyleFeedbackArgs = Static<typeof submitStyleFeedbackArgsSchema>;
