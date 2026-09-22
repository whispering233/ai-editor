// 拆解批预算守卫测试（纯函数）：两侧判据边界（刚好 / 超一档）、自动拆批（含单章超限保持成批）、
// 失败文案与「模型元数据缺失 = 不设限」的退化口径。契约：docs/design/60-decompose.md §4「组批」。
//
// 数值一律由常量与夹具推导（不写死 token / 字数）——改常量时断言跟着走。
import { describe, expect, it } from "vitest";
import { DECOMPOSE_BATCH_TARGET_CHARS, planBatches, type BatchChapterInput } from "./batching.js";
import {
  batchBudgetErrorText,
  checkBatchBudget,
  DECOMPOSE_CHARS_PER_TOKEN,
  DECOMPOSE_INPUT_SAFETY_TOKENS,
  DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER,
  planBatchesWithinBudget,
  type BatchBudgetVerdict,
  type DecomposeBatchBudget,
} from "./budget.js";

/** 正文字数 → 估算 token（与实现同一口径：每 token 折算、向上取整） */
function tokensOf(chars: number): number {
  return Math.ceil(chars / DECOMPOSE_CHARS_PER_TOKEN);
}

/** 固定开销夹具（不是被测常量：只是「每批固定开销」的一个取值） */
const OVERHEAD_TOKENS = 1000;
/** 单章正文夹具（按 token 取字数 ⇒ 无取整误差；算式：chars = tokens × 每 token 字数） */
const CHAPTER_TOKENS = 2000;
const CHAPTER_CHARS = CHAPTER_TOKENS * DECOMPOSE_CHARS_PER_TOKEN;
/** 大窗口夹具（远超任何夹具批的输入；用于只验输出侧 / 不设限的用例） */
const HUGE_WINDOW = 10_000_000;

/** 让 `CHAPTER_CHARS` 恰好折算回 `CHAPTER_TOKENS` 的夹具自检（常量换值时会先在这里炸，而不是让断言失真） */
function assertChapterFixture(): void {
  if (tokensOf(CHAPTER_CHARS) !== CHAPTER_TOKENS) {
    throw new Error(`夹具失真：${CHAPTER_CHARS} 字折算 ${tokensOf(CHAPTER_CHARS)} token ≠ ${CHAPTER_TOKENS}`);
  }
}

/** 章夹具（等字数） */
function chaptersOf(count: number, charCount = CHAPTER_CHARS): BatchChapterInput[] {
  return Array.from({ length: count }, (_, position) => ({ index: position + 1, charCount }));
}

/** 预算夹具（固定开销 + 两侧上限） */
function budgetOf(input: { contextWindow?: number; maxTokens?: number; fixedOverheadTokens?: number }): DecomposeBatchBudget {
  return {
    limits: {
      contextWindow: input.contextWindow ?? HUGE_WINDOW,
      maxTokens: input.maxTokens ?? HUGE_WINDOW,
    },
    fixedOverheadTokens: input.fixedOverheadTokens ?? OVERHEAD_TOKENS,
  };
}

describe("checkBatchBudget（§4 两侧判据）", () => {
  it("输入侧：估算输入 + 输出预留 + 安全余量恰好等于窗口 → 通过；正文多一档 → 超限（issue = input）", () => {
    assertChapterFixture();
    // 窗口 = 安全余量 + 单章输出预留 + 固定开销 + 单章正文（= 恰好装下一章）
    const contextWindow = DECOMPOSE_INPUT_SAFETY_TOKENS + DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER + OVERHEAD_TOKENS + CHAPTER_TOKENS;
    const limits = { contextWindow, maxTokens: HUGE_WINDOW };

    const fits = checkBatchBudget({ chapterChars: [CHAPTER_CHARS], fixedOverheadTokens: OVERHEAD_TOKENS, limits });
    expect(fits.issue).toBeNull();
    expect(fits.inputTokens).toBe(OVERHEAD_TOKENS + CHAPTER_TOKENS);
    expect(fits.inputLimitTokens).toBe(OVERHEAD_TOKENS + CHAPTER_TOKENS); // 窗口 − 输出预留（1 章） − 安全余量
    expect(fits.outputTokens).toBe(DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER);

    // 正文涨到下一档（多 1 token）：估算输入 > 可用上限 → input
    const over = checkBatchBudget({
      chapterChars: [CHAPTER_CHARS + DECOMPOSE_CHARS_PER_TOKEN],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits,
    });
    expect(over.issue).toBe("input");
    expect(over.inputTokens).toBe(fits.inputTokens + 1);
  });

  it("输出侧：章数 × 每章预算恰好等于 maxTokens → 通过；多一章 → 超限（issue = output）", () => {
    const maxTokens = 3 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER;
    const limits = { contextWindow: HUGE_WINDOW, maxTokens };

    const fits = checkBatchBudget({ chapterChars: [1, 1, 1], fixedOverheadTokens: OVERHEAD_TOKENS, limits });
    expect(fits.issue).toBeNull();
    expect(fits.outputTokens).toBe(maxTokens);
    expect(fits.outputLimitTokens).toBe(maxTokens);

    const over = checkBatchBudget({ chapterChars: [1, 1, 1, 1], fixedOverheadTokens: OVERHEAD_TOKENS, limits });
    expect(over.issue).toBe("output");
    expect(over.outputTokens).toBe(maxTokens + DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER);
  });

  it("输出预留也吃窗口：输出虽在 maxTokens 内，但叠加后挤爆窗口 → issue = input（先判输入侧）", () => {
    // 窗口 = 安全余量 + 两章输出预留 + 固定开销 − 1 ⇒ 输入侧差 1 token
    const contextWindow = DECOMPOSE_INPUT_SAFETY_TOKENS + 2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER + OVERHEAD_TOKENS - 1;
    const verdict = checkBatchBudget({
      chapterChars: [1, 1],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits: { contextWindow, maxTokens: HUGE_WINDOW },
    });
    expect(verdict.issue).toBe("input");
    expect(verdict.inputLimitTokens).toBe(OVERHEAD_TOKENS - 1);
    expect(verdict.outputTokens).toBe(2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER); // 输出侧自身上限内
  });

  it("模型元数据缺失 / 非法（≤ 0、非有限）→ 该侧不设限（不拿未知值判死）", () => {
    const chapters = [CHAPTER_CHARS, CHAPTER_CHARS, CHAPTER_CHARS];
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = checkBatchBudget({
        chapterChars: chapters,
        fixedOverheadTokens: OVERHEAD_TOKENS,
        limits: { contextWindow: bad, maxTokens: bad },
      });
      expect(verdict.issue).toBeNull();
      expect(verdict.inputLimitTokens).toBeNull();
      expect(verdict.outputLimitTokens).toBeNull();
    }
  });

  it("单轴缺失：一侧合法一侧非法时只关对应侧（窗口合法 + maxTokens 非法 → 只输出侧不设限，反之亦然）", () => {
    const outputUnlimited = checkBatchBudget({
      chapterChars: [CHAPTER_CHARS],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits: { contextWindow: HUGE_WINDOW, maxTokens: 0 },
    });
    expect(outputUnlimited.outputLimitTokens).toBeNull();
    expect(outputUnlimited.inputLimitTokens).not.toBeNull();

    const inputUnlimited = checkBatchBudget({
      chapterChars: [1, 1],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits: { contextWindow: 0, maxTokens: 2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER },
    });
    expect(inputUnlimited.inputLimitTokens).toBeNull();
    expect(inputUnlimited.outputLimitTokens).toBe(2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER); // 输出侧照判，两章恰在上限内
    expect(inputUnlimited.issue).toBeNull();
  });

  it("空批（零章）不超限；判定结果带规模数字（文案与断言共用）", () => {
    const verdict = checkBatchBudget({ chapterChars: [], fixedOverheadTokens: OVERHEAD_TOKENS, limits: { contextWindow: HUGE_WINDOW, maxTokens: HUGE_WINDOW } });
    expect(verdict).toMatchObject({ issue: null, chapterCount: 0, textChars: 0, outputTokens: 0 });
  });
});

describe("planBatchesWithinBudget（§4 组批守卫）", () => {
  it("预算宽裕 → 与结构组批逐字一致（不合并、不重排）", () => {
    const chapters = chaptersOf(3);
    expect(planBatchesWithinBudget(chapters, budgetOf({}))).toEqual(planBatches(chapters));
  });

  it("输出侧上限压章数：结构上的一批按 maxTokens ÷ 每章预算拆开（章序保序）", () => {
    const perBatch = 2; // 章/批
    const chapters = chaptersOf(5);
    const plan = planBatchesWithinBudget(chapters, budgetOf({ maxTokens: perBatch * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER }));
    expect(plan.map((batch) => batch.chapterIndexes)).toEqual([[1, 2], [3, 4], [5]]);
    expect(plan.map((batch) => batch.charCount)).toEqual([CHAPTER_CHARS * 2, CHAPTER_CHARS * 2, CHAPTER_CHARS]);
  });

  it("输入侧上限压字数：按章边界拆（刚好装两章 → 每两章一批）", () => {
    // 窗口 = 安全余量 + 两章输出预留 + 固定开销 + 两章正文 ⇒ 恰好两章一批（三章即超）
    const contextWindow =
      DECOMPOSE_INPUT_SAFETY_TOKENS + 2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER + OVERHEAD_TOKENS + 2 * CHAPTER_TOKENS;
    const plan = planBatchesWithinBudget(chaptersOf(5), budgetOf({ contextWindow }));
    expect(plan.map((batch) => batch.chapterIndexes)).toEqual([[1, 2], [3, 4], [5]]);
    expect(plan.map((batch) => batch.charCount)).toEqual([CHAPTER_CHARS * 2, CHAPTER_CHARS * 2, CHAPTER_CHARS]);
  });

  it("单章自身超预算 → 保持单章成批（不切章、不丢章；判定给出 input 超限）", () => {
    const budget = budgetOf({ contextWindow: DECOMPOSE_INPUT_SAFETY_TOKENS + DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER });
    const huge = DECOMPOSE_BATCH_TARGET_CHARS * 4;
    const plan = planBatchesWithinBudget([{ index: 1, charCount: huge }, { index: 2, charCount: 100 }], budget);
    expect(plan).toEqual([
      { chapterIndexes: [1], charCount: huge },
      { chapterIndexes: [2], charCount: 100 },
    ]);
    expect(checkBatchBudget({ chapterChars: [huge], fixedOverheadTokens: OVERHEAD_TOKENS, limits: budget.limits }).issue).toBe("input");
  });

  it("空范围 → 零批；不改写入参（纯函数）", () => {
    expect(planBatchesWithinBudget([], budgetOf({}))).toEqual([]);
    const chapters = chaptersOf(4);
    const snapshot = structuredClone(chapters);
    planBatchesWithinBudget(chapters, budgetOf({ maxTokens: DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER }));
    expect(chapters).toEqual(snapshot);
  });
});

describe("batchBudgetErrorText（§4 预检失败文案的唯一组装点）", () => {
  /** 造一个确定超限的判定（便于文案断言；数值全由常量与夹具推导） */
  function inputFailure(chapterCount: number): BatchBudgetVerdict {
    const limits = { contextWindow: DECOMPOSE_INPUT_SAFETY_TOKENS + 2 * DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER, maxTokens: HUGE_WINDOW };
    return checkBatchBudget({
      chapterChars: chaptersOf(chapterCount).map((chapter) => chapter.charCount),
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits,
    });
  }

  it("单章超限：文案含「批输入超出模型上下文预算」「单章 X 字」与可用上限；不改用更大窗口的语气缺失", () => {
    const verdict = inputFailure(1);
    expect(verdict.issue).toBe("input");
    const text = batchBudgetErrorText(verdict);
    expect(text).toContain("批输入超出模型上下文预算");
    expect(text).toContain(`单章 ${verdict.textChars} 字`);
    expect(text).toContain(`可用上限 ${verdict.inputLimitTokens} token`);
    expect(text).toContain("请改用更大窗口模型或缩小范围");
  });

  it("多章超限：文案报批内章数（不冒充单章）", () => {
    const verdict = inputFailure(3);
    expect(batchBudgetErrorText(verdict)).toContain(`本批 ${verdict.chapterCount} 章`);
  });

  it("输出侧超限：文案给出「章数 × 每章预算 = 输出 / 上限 maxTokens」（每章预算由常量插值）", () => {
    const maxTokens = DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER; // 只放得下一章
    const verdict = checkBatchBudget({
      chapterChars: [1, 1],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits: { contextWindow: HUGE_WINDOW, maxTokens },
    });
    expect(verdict.issue).toBe("output");
    const text = batchBudgetErrorText(verdict);
    expect(text).toContain(`每章预算 ${DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER} token`);
    expect(text).toContain(`上限 ${maxTokens} token`);
    expect(text).toContain("请减小批内章数或改用输出上限更大的模型");
  });

  it("窗口小于输出预留 + 安全余量：可用上限为负 → 改报「窗口不足以容纳…」（不展示负数上限）", () => {
    const verdict = checkBatchBudget({
      chapterChars: [1],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits: { contextWindow: DECOMPOSE_INPUT_SAFETY_TOKENS + DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER - 1, maxTokens: HUGE_WINDOW },
    });
    expect(verdict.issue).toBe("input");
    expect(verdict.inputLimitTokens).toBeLessThan(0);
    const text = batchBudgetErrorText(verdict);
    expect(text).toContain("批输入超出模型上下文预算");
    expect(text).toContain("窗口不足以容纳输出预留");
    expect(text).toContain(`安全余量（${DECOMPOSE_INPUT_SAFETY_TOKENS} token）`);
    expect(text).not.toContain("可用上限");
  });

  it("单章超 maxTokens：章是最小单位 → 不劝「减小批内章数」（换成改用输出上限更大的模型）", () => {
    const maxTokens = DECOMPOSE_OUTPUT_TOKENS_PER_CHAPTER - 1;
    const verdict = checkBatchBudget({
      chapterChars: [1],
      fixedOverheadTokens: OVERHEAD_TOKENS,
      limits: { contextWindow: HUGE_WINDOW, maxTokens },
    });
    expect(verdict.issue).toBe("output");
    const text = batchBudgetErrorText(verdict);
    expect(text).toContain("单章输出预留");
    expect(text).toContain(`上限 ${maxTokens} token`);
    expect(text).not.toContain("请减小批内章数");
  });

  it("未超限却取文案 = 调用方判据错 → 抛错（不返回空串把错误静默掉）", () => {
    const verdict = checkBatchBudget({ chapterChars: [1], fixedOverheadTokens: 0, limits: { contextWindow: HUGE_WINDOW, maxTokens: HUGE_WINDOW } });
    expect(verdict.issue).toBeNull();
    expect(() => batchBudgetErrorText(verdict)).toThrow();
  });
});
