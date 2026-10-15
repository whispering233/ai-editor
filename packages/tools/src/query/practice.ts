// 查询类工具：作家文风练习（四只读分页 + 三写 AI 自己的产出，2026-10 改版）
//
// 口径（docs/api/tool-calling.md「练习（2026-10）」、docs/design/60-practice.md §6/§7/§8）：
// - get_practice_sample / get_practice_draft / get_free_draft / get_style_notes：分页读**范文快照**、
//   **仿写稿**、**自由练习稿**、**作家风格说明**——四者都不进本轮上下文，AI 按需拉取；offset / max_chars
//   与 get_chapter_text **共用同一对分页常量**（`query/manuscript.ts` 的 DEFAULT_TEXT_PAGE_CHARS /
//   MAX_TEXT_PAGE_CHARS——文本分页预算单源，实现层 clamp）；截断时 text 末尾附续读提示
//   （「截断必须显式告知」，docs/design/20-context.md §2）
// - 三个写工具只写 **AI 自己的产出**（`feedback` / `topic` / `brief`）：工具面**没有任何写稿入口**
//   （用户稿只有用户能写——结构性边界，不是提示词约束）；提交前逐条校验引用子串，不匹配即丢弃并计入
//   dropped_quotes（不阻断、不重试）；空串 / 纯空白引用同样丢弃（否则 `includes("")` 恒真）
// - 引用校验**按字段分源**：`sample_quotes` ⊆ 该形态的依据（仿写 = 范文 `text`、自由练习 = 风格说明
//   （用户覆盖 `??` shared 预置）），`draft_quotes` ⊆ 用户稿 `draft`
// - 写库一律经 db helper——禁止在工具层直写表（库写入唯一入口）
//
// **分页预算实测**（真路径 `truncateToolResultText(stringifyToolResult(结果))`，纯 CJK 文本、正文 = 页
// 上限 `MAX_TEXT_PAGE_CHARS` + 1 字、信封字段取满 = 最长预置作品名 + `excerpt_label` 上限
// `MAX_PRACTICE_EXCERPT_LABEL_CHARS`）：
// - `get_practice_sample` 上限页 = **7163 tokens**（余量 10.5%）
// - `get_style_notes` 上限页 = **7053 tokens**（余量 11.8%）
// 两者都在单条上限 `TOOL_RESULT_MAX_TOKENS` 以内（续读提示与 `truncated` 标记不被外层截断切掉）。
// 改任一上限前必须重走同一条路径（口径同 manuscript.ts）。

import {
  getPracticePiece,
  getPracticeSample,
  getStylePack,
  readProjectFile,
  updatePracticeFeedback,
  updatePracticePieceFeedback,
  updatePracticePieceTopic,
  type PracticePieceRow,
  type PracticeSampleRow,
} from "@whispering233/ai-editor-db";
import {
  MAX_FEEDBACK_DIMENSIONS,
  PRACTICE_OTHER_WORK_LABEL,
  resolveAuthor,
  resolveWork,
  type AuthorEntry,
  type PracticeFeedbackCard,
} from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { DEFAULT_TEXT_PAGE_CHARS, MAX_TEXT_PAGE_CHARS } from "./manuscript.js";
import type {
  FeedbackDimensionArgs,
  FreeDraftPageArgs,
  PracticeTextPageArgs,
  StyleNotesPageArgs,
  SubmitFreeFeedbackArgs,
  SubmitPracticeTopicArgs,
  SubmitStyleFeedbackArgs,
} from "../schemas/index.js";

/** 只读工具的分页信封（四个只读工具**同形**；工具目录逐字对齐 docs/api/tool-calling.md「练习」） */
export interface PracticeTextPage {
  /** 本次所读文本全长（范文 / 稿件 / 风格说明），与 offset 无关 */
  char_count: number;
  offset: number;
  /** 本次实际返回的文本片段长度（不含截断提示文案） */
  returned_chars: number;
  text: string;
  truncated: boolean;
}

/** 范文 / 仿写稿页（两个样本侧只读工具同形）：`work_name` 为空即 shared 兜底文案「其他」 */
export interface PracticeSampleTextPage extends PracticeTextPage {
  sample_id: string;
  /** 关联作品名（点评对照需要，免二次查询；`work_id` 空 / 未知 → shared `PRACTICE_OTHER_WORK_LABEL`） */
  work_name: string;
  /** 片段说明（用户手填，如「汪曾祺《受戒》节选」；空 = 未填） */
  excerpt_label: string;
}

/** 自由练习稿页（get_free_draft；自由练习不挂作品 / 片段说明，故只有 piece_id） */
export interface FreeDraftTextPage extends PracticeTextPage {
  piece_id: string;
}

/** 风格说明页（get_style_notes）：`customized` = 有用户覆盖（内容 = 覆盖 `??` 预置） */
export interface StyleNotesTextPage extends PracticeTextPage {
  author_id: string;
  author_name: string;
  customized: boolean;
}

/** 提交点评结果（两个提交工具同形；随 `tool_execution_end` 帧下发，前端据此即时刷新卡片） */
export interface SubmitFeedbackResult {
  saved: true;
  /** 落库的维度数 */
  dimension_count: number;
  /** 被丢弃的引用条数（依据侧 + 稿件侧合计；逐字找不到的引用，以及空串 / 纯空白引用） */
  dropped_quotes: number;
}

/** 出题结果（随 `tool_execution_end` 帧下发；前端据 `piece_id` 重拉该篇详情） */
export interface SubmitPracticeTopicResult {
  saved: true;
  piece_id: string;
}

/**
 * 当前工作区的预置作家（`project.json` 的 `author_id` 经 shared `resolveAuthor` 解析）。
 * 读侧容错：解析不到返回 null（读范文 / 稿件不该因作家未关联而失败——作品名退兜底文案）。
 */
function currentAuthor(ctx: ToolContext): AuthorEntry | null {
  return resolveAuthor(readProjectFile(ctx.outlineDir)?.author_id);
}

/**
 * 需要作家事实的路径（读 / 写风格说明）用的严格解析。
 * @throws Error 工作区未关联预置作家（`author_id` 缺失 / 未知）——风格说明的来源不存在
 */
function requireAuthor(ctx: ToolContext): AuthorEntry {
  const author = currentAuthor(ctx);
  if (author === null) {
    throw new Error("练习工作区未关联预置作家（project.json 的 author_id 缺失或未知）");
  }
  return author;
}

/**
 * 生效的风格说明 = 用户覆盖 `??` shared 预置（与 `GET /practice/style-pack` 同一口径）；
 * `customized` = 存在用户覆盖（删除覆盖即恢复预置）。
 */
function effectiveStyleNotes(ctx: ToolContext, author: AuthorEntry): { content: string; customized: boolean } {
  const override = getStylePack(ctx.db, author.id);
  return { content: override?.content ?? author.styleNotes, customized: override !== null };
}

/** 作品名：`work_id` 空 / 未知（含作家未关联）→ shared 兜底文案「其他」 */
function workNameOf(author: AuthorEntry | null, workId: string | null): string {
  if (author === null || workId === null) return PRACTICE_OTHER_WORK_LABEL;
  return resolveWork(author.id, workId)?.name ?? PRACTICE_OTHER_WORK_LABEL;
}

/**
 * 样本行（两个样本侧只读工具与仿写点评共用）。
 * @throws Error 样本不存在
 */
function requireSample(ctx: ToolContext, sampleId: string): PracticeSampleRow {
  const sample = getPracticeSample(ctx.db, sampleId);
  if (sample === null) throw new Error(`练习样本不存在（sample_id=${sampleId}）`);
  return sample;
}

/**
 * 自由练习篇（自由稿只读、自由点评、出题共用）。
 * @throws Error 篇不存在
 */
function requirePiece(ctx: ToolContext, pieceId: string): PracticePieceRow {
  const piece = getPracticePiece(ctx.db, pieceId);
  if (piece === null) throw new Error(`自由练习不存在（piece_id=${pieceId}）`);
  return piece;
}

/**
 * 文本分页切片 + 截断续读提示（形状照 `query/manuscript.ts` 的 get_chapter_text：同样只认字符下标，
 * 同样由被截断的那一页显式告知续读起点）。
 *
 * clamp 上限取 `MAX_TEXT_PAGE_CHARS`（与 get_chapter_text **同一常量**）——预算必须连 JSON 信封
 * 与续读提示一起压进单条工具结果预算（agent 侧 `TOOL_RESULT_MAX_TOKENS`，实测口径见 manuscript.ts）。
 */
function readTextPage<T extends object>(
  fields: T,
  sourceText: string,
  args: { offset?: number; max_chars?: number },
): T & PracticeTextPage {
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
 * @throws Error 样本不存在；offset 非非负整数（schema 之外防御）
 */
export function runGetPracticeSample(ctx: ToolContext, args: PracticeTextPageArgs): PracticeSampleTextPage {
  const sample = requireSample(ctx, args.sample_id);
  return readTextPage(
    {
      sample_id: sample.id,
      work_name: workNameOf(currentAuthor(ctx), sample.work_id),
      excerpt_label: sample.excerpt_label,
    },
    sample.text,
    args,
  );
}

/**
 * 用户仿写稿只读分页（get_practice_draft(sample_id, offset?, max_chars?)）。
 * 未写稿 → char_count=0、text=""（不报错）；**只读**——工具面不存在写稿工具。
 * @throws Error 样本不存在；offset 非非负整数
 */
export function runGetPracticeDraft(ctx: ToolContext, args: PracticeTextPageArgs): PracticeSampleTextPage {
  const sample = requireSample(ctx, args.sample_id);
  return readTextPage(
    {
      sample_id: sample.id,
      work_name: workNameOf(currentAuthor(ctx), sample.work_id),
      excerpt_label: sample.excerpt_label,
    },
    sample.draft,
    args,
  );
}

/**
 * 用户自由练习稿只读分页（get_free_draft(piece_id, offset?, max_chars?)）。
 * 未写稿 → char_count=0、text=""（不报错）；**只读**——工具面不存在写稿工具。
 * @throws Error 篇不存在；offset 非非负整数
 */
export function runGetFreeDraft(ctx: ToolContext, args: FreeDraftPageArgs): FreeDraftTextPage {
  const piece = requirePiece(ctx, args.piece_id);
  return readTextPage({ piece_id: piece.id }, piece.draft, args);
}

/**
 * 作家风格说明只读分页（get_style_notes(offset?, max_chars?)）——自由练习点评的**唯一依据**
 * （仿写点评可按需参考，不强制引用）。
 * 内容 = 用户覆盖 `??` 预置；整份说明按长文分页（不整份灌入上下文）。
 * @throws Error 工作区未关联预置作家；offset 非非负整数
 */
export function runGetStyleNotes(ctx: ToolContext, args: StyleNotesPageArgs): StyleNotesTextPage {
  const author = requireAuthor(ctx);
  const notes = effectiveStyleNotes(ctx, author);
  return readTextPage(
    { author_id: author.id, author_name: author.name, customized: notes.customized },
    notes.content,
    args,
  );
}

/**
 * 逐条子串校验：保留能在 `source` 里逐字找到的引用，其余（含 trim 后为空的串）丢弃并累加计数
 * （docs/design/60-practice.md §6 硬规则①：不匹配直接丢弃，不阻断卡片、不重试——空引用走**同一条**
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
 * 维度上限守卫（两个提交工具共用）：超 `MAX_FEEDBACK_DIMENSIONS` **抛错即失败**（不编码进 content）。
 * @throws Error 维度超上限
 */
function assertDimensionLimit(count: number): void {
  if (count > MAX_FEEDBACK_DIMENSIONS) {
    throw new Error(
      `dimensions 最多 ${MAX_FEEDBACK_DIMENSIONS} 个维度（收到 ${count} 个）——请合并或删减维度后重试`,
    );
  }
}

/**
 * 维度映射（两个提交工具共用）：`evidence` = 该次练习的依据文本（仿写 = 范文、自由练习 = 风格说明），
 * `draft` = 用户稿；两处引用各自逐条校验（差别只在 evidence 来源）。
 */
function toDimensions(
  dimensions: readonly FeedbackDimensionArgs[],
  evidence: string,
  draft: string,
  dropped: { count: number },
): PracticeFeedbackCard["dimensions"] {
  return dimensions.map((dimension) => ({
    name: dimension.name,
    sample_trait: dimension.sample_trait,
    draft_trait: dimension.draft_trait,
    sample_quotes: keepVerbatimQuotes(dimension.sample_quotes ?? [], evidence, dropped),
    draft_quotes: keepVerbatimQuotes(dimension.draft_quotes ?? [], draft, dropped),
    advice: dimension.advice,
  }));
}

/**
 * 提交仿写点评卡（submit_style_feedback(sample_id, dimensions[], summary?)）——写 `practice_samples.feedback`。
 *
 * 口径：引用校验源 = 范文 `text`（`sample_quotes`）与仿写稿 `draft`（`draft_quotes`）；
 * **全部引用非法时仍成功写卡**（卡片可以没有引用——诊断不依赖引用数）。只写 `feedback`：
 * 范文与用户稿一字不动。
 * @throws Error 维度超上限；样本不存在
 */
export function runSubmitStyleFeedback(
  ctx: ToolContext,
  args: SubmitStyleFeedbackArgs,
): SubmitFeedbackResult {
  assertDimensionLimit(args.dimensions.length);
  const sample = requireSample(ctx, args.sample_id);

  const dropped = { count: 0 };
  const dimensions = toDimensions(args.dimensions, sample.text, sample.draft, dropped);
  const card: PracticeFeedbackCard =
    args.summary === undefined ? { dimensions } : { dimensions, summary: args.summary };

  if (updatePracticeFeedback(ctx.db, sample.id, card) === null) {
    throw new Error(`练习样本不存在（sample_id=${args.sample_id}）`);
  }
  return { saved: true, dimension_count: dimensions.length, dropped_quotes: dropped.count };
}

/**
 * 提交自由练习点评卡（submit_free_feedback(piece_id, dimensions[], summary?)）——写
 * `practice_free_pieces.feedback`（卡形与仿写**同形**，差别只在引用校验源）。
 *
 * 口径：引用校验源 = 风格说明（用户覆盖 `??` 预置）与自由稿 `draft`；其余同仿写。
 * @throws Error 维度超上限；篇不存在；工作区未关联预置作家（风格说明的来源不存在）
 */
export function runSubmitFreeFeedback(
  ctx: ToolContext,
  args: SubmitFreeFeedbackArgs,
): SubmitFeedbackResult {
  assertDimensionLimit(args.dimensions.length);
  const piece = requirePiece(ctx, args.piece_id);
  const notes = effectiveStyleNotes(ctx, requireAuthor(ctx)).content;

  const dropped = { count: 0 };
  const dimensions = toDimensions(args.dimensions, notes, piece.draft, dropped);
  const card: PracticeFeedbackCard =
    args.summary === undefined ? { dimensions } : { dimensions, summary: args.summary };

  if (updatePracticePieceFeedback(ctx.db, piece.id, card) === null) {
    throw new Error(`自由练习不存在（piece_id=${args.piece_id}）`);
  }
  return { saved: true, dimension_count: dimensions.length, dropped_quotes: dropped.count };
}

/**
 * 出题（submit_practice_topic(piece_id, topic, brief?)）——写 `practice_free_pieces.topic` / `brief`
 * （`brief` 省略 = 不改）。
 *
 * **题目非空 → 抛错拒写**（防覆盖已出的题 / 用户已开始的练习；不满意的题 = 删掉该篇重建，
 * 不做覆盖式换题）；空白题目同样拒写（落库会在界面留一条看不见的「已出题」记录）。
 * @throws Error 该篇已有题目；题目空白；篇不存在
 */
export function runSubmitPracticeTopic(
  ctx: ToolContext,
  args: SubmitPracticeTopicArgs,
): SubmitPracticeTopicResult {
  const piece = requirePiece(ctx, args.piece_id);
  if (piece.topic.trim() !== "") {
    throw new Error(`该篇已有题目（piece_id=${piece.id}）——出题不覆盖已出的题；请新建一篇后重试`);
  }
  const topic = args.topic.trim();
  if (topic === "") throw new Error("题目不能为空");

  const patch = args.brief === undefined ? { topic } : { topic, brief: args.brief };
  if (updatePracticePieceTopic(ctx.db, piece.id, patch) === null) {
    throw new Error(`自由练习不存在（piece_id=${args.piece_id}）`);
  }
  return { saved: true, piece_id: piece.id };
}
