// 拆解批调度的组批纯函数：预览的预估（卡 21.4）与建档的落批规划（卡 21.5）**共用同一实现**
// （两处各写一份必然漂移：预览说 N 批、实际跑 M 批）。
// 契约：docs/design/60-decompose.md §4「组批」——目标 DECOMPOSE_BATCH_TARGET_CHARS 字/批，贪心装箱；
// 单批章数 ≤ DECOMPOSE_BATCH_MAX_CHAPTERS；单章超目标字数 → 单独成批。
// 纯函数、无 IO；阈值单一定义在本模块并导出（注释只引用常量名，不复述数字）。

/** 每批目标字数（贪心装箱的目标，不是硬上限——单章超它仍单独成批） */
export const DECOMPOSE_BATCH_TARGET_CHARS = 12_000;
/** 单批章数上限（章数过多时「逐章对齐」的产出会过长，模型也更容易漏章） */
export const DECOMPOSE_BATCH_MAX_CHAPTERS = 10;

/** 组批入参：只需要章序与字数（`SplitChapter` 满足本形状） */
export interface BatchChapterInput {
  index: number;
  charCount: number;
}

/** 一批的规划结果（chapterIndexes = 1-based 文件位置序，按章序升序；charCount = 该批各章字数和） */
export interface DecomposeBatchPlan {
  chapterIndexes: number[];
  charCount: number;
}

/**
 * 贪心装箱：按章序顺序入批，装不下（超目标字数或已满章数上限）就开新批。
 * 「单章超目标」自然落成单独一批：新批必然收下该章，下一章再入即超目标 ⇒ 只能另起一批。
 */
export function planBatches(chapters: readonly BatchChapterInput[]): DecomposeBatchPlan[] {
  const batches: DecomposeBatchPlan[] = [];
  for (const chapter of chapters) {
    const current = batches[batches.length - 1];
    if (
      current !== undefined &&
      current.chapterIndexes.length < DECOMPOSE_BATCH_MAX_CHAPTERS &&
      current.charCount + chapter.charCount <= DECOMPOSE_BATCH_TARGET_CHARS
    ) {
      current.chapterIndexes.push(chapter.index);
      current.charCount += chapter.charCount;
      continue;
    }
    batches.push({ chapterIndexes: [chapter.index], charCount: chapter.charCount });
  }
  return batches;
}
