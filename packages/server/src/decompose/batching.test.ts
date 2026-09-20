// 组批纯函数测试（预览预估与建档落批共用的同一实现）。契约：docs/design/60-decompose.md §4「组批」。
// 覆盖三条组批口径（目标字数 / 章数上限 / 单章超目标）+ 空范围 + 纯函数不改写入参。
import { describe, expect, it } from "vitest";
import {
  DECOMPOSE_BATCH_MAX_CHAPTERS,
  DECOMPOSE_BATCH_TARGET_CHARS,
  planBatches,
  type BatchChapterInput,
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
