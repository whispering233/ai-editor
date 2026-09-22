// 拆解批预算守卫（纯函数层）：组批（`planBatchesWithinBudget`）与执行期预检（runner 的 `runBatch`）
// **共用同一份估算口径**——规划按一套、执行按另一套必然漂移。
//
// 契约：docs/design/60-decompose.md §4「组批」（预算守卫）。两侧判据（都必须成立）：
// - 输入侧：估算输入（正文 + 每批固定开销）+ 输出预留（章数 × `DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER`）
//   + `DECOMPOSE_INPUT_SAFETY_TOKENS` ≤ `Model.contextWindow`；
// - 输出侧：输出预留 ≤ `Model.maxTokens`。
// 为什么必须双向：模型的一次响应既占窗口又受 `maxTokens` 封顶——只判一侧时，超限的批会被 pi 的
// `clampMaxTokensToContext` 把输出压到 1（provider 随即报错），整批重试也过不去。
//
// 模型元数据缺失（≤ 0 / 非有限）→ 该侧不设限（与 pi `clampMaxTokensToContext` 对非法 `contextWindow`
// 的退化口径同向：不拿未知值判死）。
//
// 数值单源：估算常量定义在本模块（`routes/decompose.ts` 原处 re-export，既有消费面不变）；
// 散文与注释只引用常量名，不复述数值。

import { planBatches, type BatchChapterInput, type DecomposeBatchPlan } from "./batching.js";

/** 每 token 的汉字数（中文粗估；换 tokenizer 只调这一处——预估本就是量级参考） */
export const DECOMPOSE_CHARS_PER_TOKEN = 1.5;
/** 每章输出 token 粗估（一条摘要（受 `DECOMPOSE_CHAPTER_SUMMARY_MAX_CHARS` 约束）+ 若干实体线索） */
export const DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER = 400;
/**
 * 输入侧安全余量（token）：估算输入 ≤ 窗口 − 输出预留 − 该值。
 * 覆盖「字数 → token」的估算误差与提示词渲染里未计入的部分（`DECOMPOSE_CHARS_PER_TOKEN` 是量级参考，
 * 中文实际每字可能到 1 token）——没有它，「估算刚好不超」的批在真实 tokenizer 下仍会超。
 */
export const DECOMPOSE_INPUT_SAFETY_TOKENS = 4096;

/** 模型两侧上限（`Model.contextWindow` / `Model.maxTokens` 的投影；由 llm 的模型解析点取值） */
export interface ModelTokenLimits {
  contextWindow: number;
  maxTokens: number;
}

/**
 * 组批 / 预检共用的预算：模型两侧上限 + 每批固定开销 token 粗估（系统提示 + 输出契约 + 快照）。
 * 固定开销由调用方给：它属于提示词与快照预算（各自单一定义处），本模块不复制那份推导。
 */
export interface DecomposeBatchBudget {
  limits: ModelTokenLimits;
  fixedOverheadTokens: number;
}

/** 单批预算判定入参（`chapterChars` = 批内各章正文字数） */
export interface BatchBudgetCheckInput extends DecomposeBatchBudget {
  chapterChars: readonly number[];
}

/** 超限侧（`input` = 上下文预算 / `output` = 输出预算） */
export type BatchBudgetIssue = "input" | "output";

/** 单批预算判定结果（只给数字与判据，文案归 `batchBudgetErrorText` 一处组装） */
export interface BatchBudgetVerdict {
  /** 批正文总字数 */
  textChars: number;
  /** 批内章数 */
  chapterCount: number;
  /** 估算输入 token（固定开销 + 正文） */
  inputTokens: number;
  /** 输出预留 token（章数 × `DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER`） */
  outputTokens: number;
  /** 输入侧上限 token（窗口 − 输出预留 − 安全余量；窗口缺失 / 非法 → null = 不设限） */
  inputLimitTokens: number | null;
  /** 输出侧上限 token（`maxTokens`；缺失 / 非法 → null = 不设限） */
  outputLimitTokens: number | null;
  /** 超限侧（null = 通过） */
  issue: BatchBudgetIssue | null;
}

/**
 * 单批预算判定（纯函数、确定性）：按 `BatchBudgetCheckInput` 算两侧判据。
 * 输入侧先判（它同时含输出预留，是单章超长的主败因），文案按 `issue` 分流。
 */
export function checkBatchBudget(input: BatchBudgetCheckInput): BatchBudgetVerdict {
  const textChars = input.chapterChars.reduce((sum, chars) => sum + chars, 0);
  const chapterCount = input.chapterChars.length;
  const inputTokens = input.fixedOverheadTokens + Math.ceil(textChars / DECOMPOSE_CHARS_PER_TOKEN);
  const outputTokens = chapterCount * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER;
  const contextWindow = usableLimit(input.limits.contextWindow);
  const outputLimitTokens = usableLimit(input.limits.maxTokens);
  const inputLimitTokens =
    contextWindow === null ? null : contextWindow - outputTokens - DECOMPOSE_INPUT_SAFETY_TOKENS;
  const issue: BatchBudgetIssue | null =
    inputLimitTokens !== null && inputTokens > inputLimitTokens
      ? "input"
      : outputLimitTokens !== null && outputTokens > outputLimitTokens
        ? "output"
        : null;
  return { textChars, chapterCount, inputTokens, outputTokens, inputLimitTokens, outputLimitTokens, issue };
}

/**
 * 预检失败文案（**唯一组装点**：执行期预检与单测读同一份，避免两处各写一份格式）。
 * 数字一律由常量与判定结果插值（散文不复述数值）；调用方只在 `issue !== null` 时取文案，
 * 空判据取文案属调用方判据错 → 抛错（不返回空串让错误静默丢失）。
 */
export function batchBudgetErrorText(verdict: BatchBudgetVerdict): string {
  if (verdict.issue === "input") {
    const scope =
      verdict.chapterCount === 1
        ? `单章 ${verdict.textChars} 字`
        : `本批 ${verdict.chapterCount} 章 / 合计 ${verdict.textChars} 字`;
    return (
      `批输入超出模型上下文预算：${scope}（估算输入 ${verdict.inputTokens} token / 可用上限 ${verdict.inputLimitTokens} token）；` +
      `请改用更大窗口模型或缩小范围`
    );
  }
  if (verdict.issue === "output") {
    return (
      `批输出超出模型输出预算：${verdict.chapterCount} 章 × 每章预算 ${DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER} token = ${verdict.outputTokens} token / 上限 ${verdict.outputLimitTokens} token；` +
      `请减小批内章数或改用输出上限更大的模型`
    );
  }
  throw new Error("批预算未超限，没有失败文案");
}

/**
 * 预算感知组批（落批规划用）：先按结构口径（`planBatches`：目标字数 + 章数上限）贪心装箱，
 * 再把超预算的结构批按章序细分成更小的批——
 * - **章是最小单位**：永不切开单章，细分只发生在章边界；
 * - **单章自身超预算 → 保持单章成批**：不静默丢章、不静默截断正文；执行期预检会显式失败该批，
 *   文案 = `batchBudgetErrorText`（「单章 X 字 / 预算 Y」）；
 * - 不合并结构批（目标字数是质量旋钮，不是预算旋钮）。
 */
export function planBatchesWithinBudget(
  chapters: readonly BatchChapterInput[],
  budget: DecomposeBatchBudget,
): DecomposeBatchPlan[] {
  const charsByIndex = new Map(chapters.map((chapter) => [chapter.index, chapter.charCount]));
  return planBatches(chapters).flatMap((batch) => splitBatchWithinBudget(batch, charsByIndex, budget));
}

/** 一个结构批按预算细分（章边界处切；`charsByIndex` 由同一份输入派生 ⇒ 缺项按空章兜底） */
function splitBatchWithinBudget(
  batch: DecomposeBatchPlan,
  charsByIndex: ReadonlyMap<number, number>,
  budget: DecomposeBatchBudget,
): DecomposeBatchPlan[] {
  const pieces: DecomposeBatchPlan[] = [];
  let chapterIndexes: number[] = [];
  let chapterChars: number[] = [];
  const flush = (): void => {
    if (chapterIndexes.length === 0) return;
    pieces.push({ chapterIndexes, charCount: chapterChars.reduce((sum, chars) => sum + chars, 0) });
    chapterIndexes = [];
    chapterChars = [];
  };
  for (const index of batch.chapterIndexes) {
    const charCount = charsByIndex.get(index) ?? 0;
    // 批内已有章时才判「加入该章是否超预算」：单章自身超预算也要保住这一章（保持单章成批）
    if (
      chapterIndexes.length > 0 &&
      checkBatchBudget({
        chapterChars: [...chapterChars, charCount],
        fixedOverheadTokens: budget.fixedOverheadTokens,
        limits: budget.limits,
      }).issue !== null
    ) {
      flush();
    }
    chapterIndexes.push(index);
    chapterChars.push(charCount);
  }
  flush();
  return pieces;
}

/** 可用上限归位：≤ 0 / 非有限 → null（模型元数据缺失 = 不设限） */
function usableLimit(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}
