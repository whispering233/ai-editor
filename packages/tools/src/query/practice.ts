// 查询类工具：文风仿写练习（范文 / 用户稿只读分页 + 点评卡提交，2026-10）
//
// 口径（docs/api/tool-calling.md「练习（2026-10）」、docs/design/60-practice.md §4/§5/§6）：
// - get_practice_sample / get_practice_draft：分页读**范文快照**与**用户仿写稿**——两者都不进
//   本轮上下文，AI 按需拉取；offset / max_chars 与 get_chapter_text **共用同一对分页常量**
//   （`query/manuscript.ts` 的 DEFAULT_TEXT_PAGE_CHARS / MAX_TEXT_PAGE_CHARS——文本分页预算单源，
//   实现层 clamp）；截断时 text 末尾附续读提示（「截断必须显式告知」，docs/design/20-context.md §2）
// - submit_style_feedback：**唯一**能写练习数据的工具，且只写 AI 自己的产出字段 `feedback`
//   （用户稿 `draft` 工具面不可写——结构性边界，不是提示词约束）；引用逐条校验子串，
//   不匹配即丢弃并计入 dropped_quotes（不阻断、不重试）；空串 / 纯空白引用同样丢弃
//   （否则 `includes("")` 恒真，无意义的空引用会进卡片）
// - 写库一律经 db helper（`updatePracticeFeedback`）——禁止在工具层直写表（库写入唯一入口）
//
// **分页预算实测**（真路径 `truncateToolResultText(stringifyToolResult(工具结果))`，纯 CJK 文本、
// 正文 = 页上限 + 1 字；元数据只给各行写明的字段，其余为空）：
// - 缺省页（`DEFAULT_TEXT_PAGE_CHARS`）+ 续读提示 + 目标名取满 = **6160 tokens**（余量 23.0%）
// - 上限页（`MAX_TEXT_PAGE_CHARS`）+ 续读提示 + 目标名取满 = **7160 tokens**（余量 **10.5%**，≥10% 留白）
// - 上限页 + 目标名 / `observation` / `source_label` 三项全取满 = **7759 tokens**（余量 3.0%）——仍在
//   单条上限 8000 以内，续读提示与 `truncated` 标记不被外层截断切掉；练习信封比 get_chapter_text
//   多 target_name / observation / source_label 三个字段，而 `get_practice_draft` 的本情形（稿深页、
//   元数据取满）更高一档（7760 tokens）——两者都在预算内。**目标名必须有上限**
//   （shared `MAX_PRACTICE_TARGET_NAME_CHARS`）：不设上限时 ≳350 字即可把续读提示挤出 8000 预算。
//   改任一上限前必须重走同一条路径（同 manuscript.ts 的测量口径）。

import {
  getPracticeSample,
  getPracticeTarget,
  updatePracticeFeedback,
  type PracticeSampleRow,
  type PracticeTargetRow,
} from "@whispering233/ai-editor-db";
import { MAX_FEEDBACK_DIMENSIONS, type PracticeFeedbackCard } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { DEFAULT_TEXT_PAGE_CHARS, MAX_TEXT_PAGE_CHARS } from "./manuscript.js";
import type { PracticeTextPageArgs, SubmitStyleFeedbackArgs } from "../schemas/index.js";

/** 只读工具的分页结果（两个只读工具**同形状**；工具目录逐字对齐 docs/api/tool-calling.md「练习」） */
export interface PracticeTextPageResult {
  sample_id: string;
  /** 所属文风目标名（点评对照需要，免二次查询） */
  target_name: string;
  /** 用户自己观察到的文风特点（未写 = null）——与范文/稿件同屏展示 */
  observation: string | null;
  /** 快照来源说明（用户手填，如「汪曾祺《受戒》节选」） */
  source_label: string;
  /** 本次所读文本全长（范文或稿件），与 offset 无关 */
  char_count: number;
  offset: number;
  /** 本次实际返回的文本片段长度（不含截断提示文案） */
  returned_chars: number;
  text: string;
  truncated: boolean;
}

/** 提交点评结果（工具目录逐字对齐：docs/api/tool-calling.md「练习」） */
export interface SubmitStyleFeedbackResult {
  saved: true;
  /** 落库的维度数 */
  dimension_count: number;
  /** 被丢弃的引用条数（范文侧 + 稿件侧合计；逐字找不到的引用，以及空串 / 纯空白引用） */
  dropped_quotes: number;
}

/**
 * 取样本 + 所属目标（**两者齐备才算存在**——与 REST 详情同口径：样本行在而目标行缺失的孤儿行
 * 同样视为不存在，因为「范文对照」需要目标名与观察）。
 * @throws Error 样本不存在 / 目标行缺失
 */
function requirePracticeSample(
  ctx: ToolContext,
  sampleId: string,
): { sample: PracticeSampleRow; target: PracticeTargetRow } {
  const sample = getPracticeSample(ctx.db, sampleId);
  const target = sample === null ? null : getPracticeTarget(ctx.db, sample.target_id);
  if (sample === null || target === null) {
    throw new Error(`练习样本不存在（sample_id=${sampleId}）`);
  }
  return { sample, target };
}

/**
 * 文本分页切片 + 截断续读提示（形状照 `query/manuscript.ts` 的 get_chapter_text：同样只认字符下标，
 * 同样由被截断的那一页显式告知续读起点）。
 *
 * clamp 上限取 `MAX_TEXT_PAGE_CHARS`（与 get_chapter_text **同一常量**）——预算必须连 JSON 信封
 * 与续读提示一起压进单条工具结果预算（agent 侧 `TOOL_RESULT_MAX_TOKENS`，实测口径见 manuscript.ts）。
 * 练习载荷比章正文多 target_name / observation / source_label 三个字段（实测见 file 头注释）。
 */
function readTextPage(
  fields: Omit<PracticeTextPageResult, "char_count" | "offset" | "returned_chars" | "text" | "truncated">,
  sourceText: string,
  args: PracticeTextPageArgs,
): PracticeTextPageResult {
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`offset 必须为非负整数: ${String(args.offset)}`);
  }
  const maxChars = Math.min(
    MAX_TEXT_PAGE_CHARS,
    Math.max(1, Math.trunc(args.max_chars ?? DEFAULT_TEXT_PAGE_CHARS)),
  );

  const slice = sourceText.slice(offset, offset + maxChars);
  const truncated = offset + slice.length < sourceText.length;
  const text = truncated
    ? `${slice}\n\n（已截断，可用 offset=${offset + slice.length} 继续读取）`
    : slice;

  return { ...fields, char_count: sourceText.length, offset, returned_chars: slice.length, text, truncated };
}

/**
 * 范文快照只读分页（get_practice_sample(sample_id, offset?, max_chars?)）。
 * @throws Error 样本不存在（含目标行缺失）；offset 非非负整数（schema 之外防御）
 */
export function runGetPracticeSample(ctx: ToolContext, args: PracticeTextPageArgs): PracticeTextPageResult {
  const { sample, target } = requirePracticeSample(ctx, args.sample_id);
  return readTextPage(
    {
      sample_id: sample.id,
      target_name: target.name,
      observation: target.observation,
      source_label: sample.source_label,
    },
    sample.text,
    args,
  );
}

/**
 * 用户仿写稿只读分页（get_practice_draft(sample_id, offset?, max_chars?)）。
 * 未写稿 → char_count=0、text=""（不报错）；**只读**——工具面不存在写稿工具。
 * @throws Error 样本不存在（含目标行缺失）；offset 非非负整数
 */
export function runGetPracticeDraft(ctx: ToolContext, args: PracticeTextPageArgs): PracticeTextPageResult {
  const { sample, target } = requirePracticeSample(ctx, args.sample_id);
  return readTextPage(
    {
      sample_id: sample.id,
      target_name: target.name,
      observation: target.observation,
      source_label: sample.source_label,
    },
    sample.draft,
    args,
  );
}

/**
 * 逐条子串校验：保留能在 `source` 里逐字找到的引用，其余（含 trim 后为空的串）丢弃并累加计数
 * （docs/design/60-practice.md §4 硬规则①：不匹配直接丢弃，不阻断卡片、不重试——空引用走**同一条**
 * 丢弃路径，不另立分支语义）。
 */
function keepVerbatimQuotes(quotes: readonly string[], source: string, dropped: { count: number }): string[] {
  const kept: string[] = [];
  for (const quote of quotes) {
    if (quote.trim() !== "" && source.includes(quote)) kept.push(quote);
    else dropped.count++;
  }
  return kept;
}

/**
 * 提交点评卡（submit_style_feedback(sample_id, dimensions[], summary?)）——写 `practice_samples.feedback`。
 *
 * 口径：维度数超 `MAX_FEEDBACK_DIMENSIONS` **抛错即失败**（不编码进 content）；引用逐条校验
 * （范文侧对 `text`、稿件侧对 `draft`；空串 / 纯空白与逐字找不到一律丢弃并计入 dropped_quotes）；
 * **全部引用非法时仍成功写卡**（卡片可以没有引用——诊断不依赖引用数）。只写 `feedback`：范文与用户稿一字不动。
 * @throws Error 维度超上限；样本不存在（含目标行缺失）
 */
export function runSubmitStyleFeedback(
  ctx: ToolContext,
  args: SubmitStyleFeedbackArgs,
): SubmitStyleFeedbackResult {
  if (args.dimensions.length > MAX_FEEDBACK_DIMENSIONS) {
    throw new Error(
      `dimensions 最多 ${MAX_FEEDBACK_DIMENSIONS} 个维度（收到 ${args.dimensions.length} 个）——请合并或删减维度后重试`,
    );
  }
  const { sample } = requirePracticeSample(ctx, args.sample_id);

  const dropped = { count: 0 };
  const dimensions = args.dimensions.map((dimension) => ({
    name: dimension.name,
    sample_trait: dimension.sample_trait,
    draft_trait: dimension.draft_trait,
    sample_quotes: keepVerbatimQuotes(dimension.sample_quotes ?? [], sample.text, dropped),
    draft_quotes: keepVerbatimQuotes(dimension.draft_quotes ?? [], sample.draft, dropped),
    advice: dimension.advice,
  }));
  const card: PracticeFeedbackCard = args.summary === undefined ? { dimensions } : { dimensions, summary: args.summary };

  const written = updatePracticeFeedback(ctx.db, sample.id, card);
  if (written === null) {
    throw new Error(`练习样本不存在（sample_id=${args.sample_id}）`);
  }
  return { saved: true, dimension_count: dimensions.length, dropped_quotes: dropped.count };
}
