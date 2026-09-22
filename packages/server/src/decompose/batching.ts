// 拆解批调度的组批与分段纯函数：预览的预估（卡 21.4）与建档的落批规划（卡 21.5）**共用同一实现**
// （两处各写一份必然漂移：预览说 N 批、实际跑 M 批）。
// 契约：docs/design/60-decompose.md §4「组批」——目标 DECOMPOSE_BATCH_TARGET_CHARS 字/批，贪心装箱；
// 单批章数 ≤ DECOMPOSE_BATCH_MAX_CHAPTERS；单章超目标字数 → 单独成批；
// §2.2「分段并发」——批次再按 `planSegments` 沿批边界切成 `min(并发数, 批数)` 段、按累计字数均衡
// （段内串行、段间并行；并发数来自 `decompose_jobs.concurrency` 快照）。
// 纯函数、无 IO；阈值单一定义在本模块并导出（注释只引用常量名，不复述数字）。

/** 每批目标字数（贪心装箱的目标，不是硬上限——单章超它仍单独成批；**实测保持不上调**：批越小抽取密度越高、欠章重试越可控，见 docs/design/60-decompose.md §4「批大小口径」） */
export const DECOMPOSE_BATCH_TARGET_CHARS = 12_000;
/** 单批章数上限（章数过多时「逐章对齐」的产出会过长，模型也更容易漏章）——**批大小的实际上限**（target 上调前先撞它）；实测同样保持不上调 */
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

// ============ 分段（§2.2：段间并行、段内串行） ============

/** 段划分入参：一批的序号与字数（`charCount` = 该批各章正文投影长度和） */
export interface SegmentBatchInput {
  seq: number;
  charCount: number;
}

/**
 * 段划分（纯函数、确定性）：沿批边界把批序切成 `min(并发数, 批数)` 段，按**累计字数**均衡——
 * 切点取「前缀和离等分目标最近」的批边界（距离并列时取靠前的切点），段内批序不变、章不切开。
 *
 * 为什么按字数而不是批数：段内串行 ⇒ 段的墙钟 ∝ 该段输出量（≈ 字数），按字数均衡才不会被
 * 「恰好含一两章超长批」的段拖长（§2.2 墙钟 ≈ 总输出 ÷ 解码速度）。
 *
 * 并发数非法（< 1 / 非有限值）退化为单段；段数永远 ≤ 批数（空批列表 → 零段）。
 * resume / 单批重跑用同一份输入（job 的批规划 + `decompose_jobs.concurrency` 快照）⇒ 段划分可重算。
 */
export function planSegments(batches: readonly SegmentBatchInput[], concurrency: number): number[][] {
  if (batches.length === 0) return [];
  const segmentCount = Math.min(safeConcurrency(concurrency), batches.length);
  // 前缀和：prefix[i] = 前 i 批的字数和（切点 i 即「前 i 批归前面各段」）
  const prefix: number[] = [0];
  for (const batch of batches) prefix.push(prefix[prefix.length - 1]! + batch.charCount);
  const total = prefix[batches.length]!;
  const bounds = [0];
  for (let k = 1; k < segmentCount; k++) {
    const min = bounds[k - 1]! + 1; // 前面的段已占至少 1 批
    const max = batches.length - (segmentCount - k); // 后面的段各留至少 1 批
    const target = (total * k) / segmentCount;
    let best = min;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = min; index <= max; index++) {
      const distance = Math.abs(prefix[index]! - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    bounds.push(best);
  }
  bounds.push(batches.length);
  const segments: number[][] = [];
  for (let k = 0; k < segmentCount; k++) {
    segments.push(batches.slice(bounds[k]!, bounds[k + 1]!).map((batch) => batch.seq));
  }
  return segments;
}

/** 并发数归位：非法值（< 1 / NaN / Infinity）→ 单段；小数向下取整 */
function safeConcurrency(concurrency: number): number {
  return Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
}
