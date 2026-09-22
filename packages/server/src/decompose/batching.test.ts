// 组批纯函数测试（预览预估与建档落批共用的同一实现）。契约：docs/design/60-decompose.md §4「组批」。
// 覆盖三条组批口径（目标字数 / 章数上限 / 单章超目标）+ 空范围 + 纯函数不改写入参。
import { describe, expect, it } from "vitest";
import {
  DECOMPOSE_BATCH_MAX_CHAPTERS,
  DECOMPOSE_BATCH_TARGET_CHARS,
  planBatches,
  planSegments,
  type BatchChapterInput,
  type SegmentBatchInput,
} from "./batching.js";

/** 造 `count` 章，每章字数固定（便于精确算装箱边界） */
function chapters(count: number, charCount: number): BatchChapterInput[] {
  return Array.from({ length: count }, (_, position) => ({ index: position + 1, charCount }));
}

describe("planBatches（docs/design/60-decompose.md §4 组批）", () => {
  it("空范围 → 零批（范围越界落空即此形状）", () => {
    expect(planBatches([])).toEqual([]);
  });

  it("总字数不超目标且章数不超上限 → 单批装齐，章序保序", () => {
    expect(planBatches(chapters(3, 100))).toEqual([{ chapterIndexes: [1, 2, 3], charCount: 300 }]);
  });

  it("加入即超目标字数 → 开新批（贪心不借后续章凑数）", () => {
    const half = Math.floor(DECOMPOSE_BATCH_TARGET_CHARS / 2);
    const plan = planBatches(chapters(4, half));
    expect(plan.map((batch) => batch.chapterIndexes)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(plan.map((batch) => batch.charCount)).toEqual([half * 2, half * 2]);
  });

  it("章数上限 → 满即开新批（字数远未到目标也开）", () => {
    const plan = planBatches(chapters(DECOMPOSE_BATCH_MAX_CHAPTERS + 1, 1));
    expect(plan.map((batch) => batch.chapterIndexes.length)).toEqual([DECOMPOSE_BATCH_MAX_CHAPTERS, 1]);
  });

  it("单章超目标字数 → 单独成批（不拆章、不等分）", () => {
    const huge = DECOMPOSE_BATCH_TARGET_CHARS * 3;
    expect(planBatches([{ index: 1, charCount: huge }, { index: 2, charCount: 10 }])).toEqual([
      { chapterIndexes: [1], charCount: huge },
      { chapterIndexes: [2], charCount: 10 },
    ]);
    // 反向（[小, 巨]）：超目标章同样不得并入前面的小批（批未满也照样开新批）
    expect(planBatches([{ index: 1, charCount: 10 }, { index: 2, charCount: huge }])).toEqual([
      { chapterIndexes: [1], charCount: 10 },
      { chapterIndexes: [2], charCount: huge },
    ]);
  });

  it("不改写入参（纯函数）", () => {
    const input = chapters(3, 100);
    const snapshot = structuredClone(input);
    planBatches(input);
    expect(input).toEqual(snapshot);
  });
});

/** 批字号列表（段划分测试用：seq 从 1 起） */
function batchesOfF(charCounts: readonly number[]): SegmentBatchInput[] {
  return charCounts.map((charCount, position) => ({ seq: position + 1, charCount }));
}

describe("planSegments（docs/design/60-decompose.md §2.2 分段）", () => {
  it("空批列表 → 零段（零批 job 不建空 worker）", () => {
    expect(planSegments([], 4)).toEqual([]);
  });

  it("批数少于并发数 → 一段一批（段数 = 批数，不空转）", () => {
    expect(planSegments(batchesOfF([10, 20]), 8)).toEqual([[1], [2]]);
    expect(planSegments(batchesOfF([10]), 8)).toEqual([[1]]);
  });

  it("单批（并发再大也是单段）", () => {
    expect(planSegments(batchesOfF([999]), 4)).toEqual([[1]]);
  });

  it("并发 1 → 单段含全部批（保序）", () => {
    expect(planSegments(batchesOfF([10, 20, 30]), 1)).toEqual([[1, 2, 3]]);
  });

  it("字数均衡：切点取离等分目标最近的前缀（等长批落在正中）", () => {
    expect(planSegments(batchesOfF([10, 10, 10, 10]), 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(planSegments(batchesOfF([10, 10, 10, 10]), 4)).toEqual([[1], [2], [3], [4]]);
    // 3 段：目标 10 / 20；前缀 10（差 0）、20（差 0）⇒ 切在 1、2 之后
    expect(planSegments(batchesOfF([10, 10, 10]), 3)).toEqual([[1], [2], [3]]);
  });

  it("累计字数悬殊：超长批自成一段，不为凑字数把段切成空段", () => {
    // 总 105、2 段 ⇒ 目标 52.5；前缀 100（差 47.5）最近 ⇒ 第一段只含超长批
    expect(planSegments(batchesOfF([100, 1, 1, 1, 1, 1]), 2)).toEqual([[1], [2, 3, 4, 5, 6]]);
    // 反向（超长批在尾）：切点取 1（差 49）而不是 5（差 49.6）
    expect(planSegments(batchesOfF([1, 1, 1, 1, 1, 100]), 2)).toEqual([[1, 2, 3, 4, 5], [6]]);
  });

  it("并发数非法（0 / 负数 / NaN）→ 单段；同距离切点取靠前者（段内批序 = 输入批序的连续区间）", () => {
    expect(planSegments(batchesOfF([5, 5]), 0)).toEqual([[1, 2]]);
    expect(planSegments(batchesOfF([5, 5]), -3)).toEqual([[1, 2]]);
    expect(planSegments(batchesOfF([5, 5]), Number.NaN)).toEqual([[1, 2]]);
    // 前缀 5 与 10 离目标 7.5 同距 ⇒ 取靠前切点（1 之后）
    expect(planSegments(batchesOfF([5, 5, 5]), 2)).toEqual([
      [1],
      [2, 3],
    ]);
  });

  it("不改写入参（纯函数）", () => {
    const input = batchesOfF([1, 2, 3, 4]);
    const snapshot = structuredClone(input);
    planSegments(input, 3);
    expect(input).toEqual(snapshot);
  });
});
