// 工具参数 schema：作家文风练习域（四只读 + 三写 AI 产出，2026-10 改版）
//
// 口径见 docs/api/tool-calling.md「练习（2026-10）」与 docs/design/60-practice.md §6/§7：
// 四个只读工具按 offset / max_chars 分页（缺省与上限 = `query/manuscript.ts` 的
// `DEFAULT_TEXT_PAGE_CHARS` / `MAX_TEXT_PAGE_CHARS`，与 get_chapter_text 同一对常量）；
// 提交工具的卡内层字段恒 snake_case（同 shared `practiceFeedbackSchema` / FeedbackCard）。
// 长度上限（题目 / 写作要求）由 shared 常量作 schema 约束——**描述插值 + 校验同源**，不手抄数字。

import { Type, type Static } from "@earendil-works/pi-ai";
import { MAX_PRACTICE_BRIEF_CHARS, MAX_PRACTICE_TOPIC_CHARS } from "@whispering233/ai-editor-shared";

/**
 * 分页公共字段（四个只读工具共用）：offset 为起始字符下标（缺省 0）、max_chars 为本次最多返回字符数
 * （缺省与上限见 `query/manuscript.ts` 的两个分页常量——实现层 clamp）。
 */
const textPageFields = {
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  max_chars: Type.Optional(Type.Integer({ minimum: 1 })),
};

/**
 * 仿写侧文本分页入参（get_practice_sample 与 get_practice_draft **同形**：都读样本里的一段文本）：
 * sample_id 必填（ps-*）——范文与稿件都挂在样本行上。
 */
export const practiceTextPageArgsSchema = Type.Object(
  {
    sample_id: Type.String(),
    ...textPageFields,
  },
  { additionalProperties: false },
);

export type PracticeTextPageArgs = Static<typeof practiceTextPageArgsSchema>;

/**
 * 自由练习稿分页入参（get_free_draft）：piece_id 必填（pf-*）。
 * 刻意不做「一个工具 + 多态 id」——两张表的语义与引用校验源不同（见 docs/api/tool-calling.md）。
 */
export const freeDraftPageArgsSchema = Type.Object(
  {
    piece_id: Type.String(),
    ...textPageFields,
  },
  { additionalProperties: false },
);

export type FreeDraftPageArgs = Static<typeof freeDraftPageArgsSchema>;

/** 风格说明分页入参（get_style_notes）：无 id——风格说明按当前工作区的作家取（一作家一份） */
export const styleNotesPageArgsSchema = Type.Object({ ...textPageFields }, { additionalProperties: false });

export type StyleNotesPageArgs = Static<typeof styleNotesPageArgsSchema>;

/**
 * 维度（点评卡的一项）：维度名 + 依据/稿件特征 + 证据引用 + 可执行建议——字段与
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

/** 维度入参类型（两个提交工具共用同一份维度 schema——卡内层同形，差别只在引用校验源） */
export type FeedbackDimensionArgs = Static<typeof feedbackDimensionSchema>;

/**
 * submit_style_feedback 入参：sample_id + dimensions（**上限 = shared `MAX_FEEDBACK_DIMENSIONS`**，
 * 实现层校验——工具描述由该常量插值生成）+ summary（可选一句话总评）。
 * **没有「示范」字段**：卡片只做诊断，没有位置放成段文字（docs/design/60-practice.md §6）。
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

/** submit_free_feedback 入参：与仿写侧**同形**，只把 sample_id 换成 piece_id（卡内层与校验口径共用） */
export const submitFreeFeedbackArgsSchema = Type.Object(
  {
    piece_id: Type.String(),
    dimensions: Type.Array(feedbackDimensionSchema),
    summary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type SubmitFreeFeedbackArgs = Static<typeof submitFreeFeedbackArgsSchema>;

/**
 * submit_practice_topic 入参：piece_id + topic + brief?（写 `practice_free_pieces.topic` / `brief`）。
 * 两个长度上限由 shared 常量作 schema 约束（超出即参数校验失败）——描述里的数字同样由常量插值。
 * **题目非空则拒写**（实现层守卫，防覆盖已出的题 / 用户已开始的练习）。
 */
export const submitPracticeTopicArgsSchema = Type.Object(
  {
    piece_id: Type.String(),
    topic: Type.String({ maxLength: MAX_PRACTICE_TOPIC_CHARS }),
    brief: Type.Optional(Type.String({ maxLength: MAX_PRACTICE_BRIEF_CHARS })),
  },
  { additionalProperties: false },
);

export type SubmitPracticeTopicArgs = Static<typeof submitPracticeTopicArgsSchema>;
