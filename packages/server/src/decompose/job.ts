// 拆解 S1 建档 + S1' 续拆建 job + job 骨架（卡 21.5 / 22.7）：建大纲（卷→章）→ 逐章导入正文段落块 →
// 落 job 与批规划行（续拆只落 job 与批规划，不建大纲不导正文）；续拆预览（plan）的库内读取面同在本模块。
// 进度轮询（GET /decompose/job）的状态投影也在这里。
//
// 契约：docs/design/60-decompose.md §2（S1 建档）/ §4（范围与组批）/ §7 / §7.1（状态机与续拆）/ §8（进度面）；
// docs/api/120-api-decompose.md §start / §plan / §continue / §job / §batches；表不变式见 docs/db/schema.md「decompose 两表」。
// 口径：
// - **正文全量导入**（不受 scope 限制）：scope 只决定批规划与 job 记录的 range（§4「范围」）；
// - 切章文本 = `splitNovelWithSlices` 的**真实切片**（归一化文本上的 `[start, end)`）——
//   **不得拿 `charCount` 当偏移量**：它是近似计数（正常路径 trim 掉分隔换行、退化路径不含空行分隔符），
//   当偏移量用会错位或丢字符（§3.4）；
// - 段落块形态与参考资料执行器（`packages/tools/src/executor/reference.ts`）同款：每行一个 `paragraph`、
//   空行 = 空段落（服务端不解析块语义、不做 markdown 转换）；`content_text` 由 shared `blocksToPlainMd`
//   从块重算（投影单一写入人，见 docs/db/schema.md「document_records」）；
// - 大纲**一次读 + 一次写**（`readOutlineFile` / `writeOutlineFile`）：节点形状与 db `createOutlineNode`
//   同构，但逐节点调用会让 N 章 × 原子写 fsync 变成 N+1 次落盘（导入一本数百章的书不可接受）；
// - 并发段数快照（`concurrency`）由调用方**建 job 时读创作根配置一次**并传入（§2.2；本模块不读配置）；
// - 批大小预算（`budget` = 模型两侧上限 + 每批固定开销）同样由调用方在建 job 时解析后传入；
//   缺省 = 只有结构组批（`planBatches`），给定 = 经 `planBatchesWithinBudget` 按预算拆批（§4 守卫）；
// - 时间（`now`）由调用方传入，本模块不生成时间。

import type { DecomposeBatchResult, DecomposeJobRes, OutlineFileChapter, OutlineFileVolume } from "@whispering233/ai-editor-shared";
import { blocksToPlainMd, generateOutlineNodeId } from "@whispering233/ai-editor-shared";
import { decomposeBatchResultSchema } from "@whispering233/ai-editor-shared/schemas";
import {
  createDecomposeJob,
  deriveChapterOrder,
  findOutlineNode,
  getDecomposeBatch,
  getDocumentTextLengths,
  getEntity,
  listDecomposeBatches,
  listDecomposeJobs,
  readOutlineFile,
  updateJobStatus,
  upsertDocument,
  writeOutlineFile,
  type Db,
  type DecomposeBatchRow,
  type DecomposeJobRow,
} from "@whispering233/ai-editor-db";
import { DECOMPOSE_BATCH_TARGET_CHARS, planBatches } from "./batching.js";
import { planBatchesWithinBudget, type DecomposeBatchBudget } from "./budget.js";
import { DECOMPOSE_REPORT_ENTITY_TYPE } from "./report.js";
import type { SplitChapter, SplitWithSlices } from "./split.js";
import type { ProjectContext } from "../middleware/project.js";

/** S1 建档入参：项目已建已开（`db` 是活动连接）、切分结果 + 范围（`scopedChapters` = 范围过滤后的章） */
export interface IngestDecomposeProjectInput {
  project: ProjectContext;
  split: SplitWithSlices;
  /** 范围过滤后的章（= 批规划输入；正文导入仍用 `split` 的全量切片） */
  scopedChapters: readonly SplitChapter[];
  scopeStart: number;
  scopeEnd: number;
  /** 本次使用的模型（`provider/id`，审计用）；未配置 → null */
  model: string | null;
  /** 并发段数快照（建 job 时由调用方读创作根配置一次，见 `decompose/config.ts`） */
  concurrency: number;
  /**
   * 批大小预算（模型两侧上限 + 每批固定开销）：落批时按它拆批（§4 预算守卫）；
   * 缺省 / null = 不设预算（只有结构组批）——模型元数据不可用的退化形态与直接建档的调用方。
   */
  budget?: DecomposeBatchBudget | null;
  now: string;
}

/** S1 建档产物：job id 与批数（start 响应字段） */
export interface IngestDecomposeProjectResult {
  jobId: string;
  batchCount: number;
}

/**
 * 纯文本 → 段落块数组（块数组最小形态：每行一个 paragraph，空行 = 空段落——
 * 与参考资料执行器 `paragraphBlocksOf` 同形态，保原文的段落/空行结构）。
 * 共用面：S1 的逐章正文导入 + S4 的拆解报告正文（服务端不解析块语义）。
 */
export function paragraphBlocksOf(text: string): unknown[] {
  return text.split("\n").map((line) => ({
    type: "paragraph",
    content: line === "" ? [] : [{ type: "text", text: line }],
  }));
}

/**
 * 建大纲：卷 → 章（严格三层；`root` 仅接纳卷），章标题 = 切分清洗后的标题（§3.3.9），
 * **`summary` 留空**（S2 抽取的章摘要由 S3 回写）。
 * @returns 章序（1-based 文件位置序）→ 章节点 id 的映射（批行 `chapter_ids` 与正文 owner 都用它）
 */
function writeOutlineFromSplit(dir: string, split: SplitWithSlices, now: string): Map<number, string> {
  const tree = readOutlineFile(dir); // 新项目 = initProject 写的空树；children 由本函数整体装配
  const chapterIdByIndex = new Map<number, string>();
  const volumes: OutlineFileVolume[] = split.result.volumes.map((volume) => {
    const chapters: OutlineFileChapter[] = split.result.chapters
      .filter((chapter) => chapter.volumeIndex === volume.index)
      .map((chapter) => {
        const id = generateOutlineNodeId("chapter");
        chapterIdByIndex.set(chapter.index, id);
        return { id, type: "chapter", title: chapter.title, updated_at: now, children: [] };
      });
    return { id: generateOutlineNodeId("volume"), type: "volume", title: volume.title, updated_at: now, children: chapters };
  });
  tree.children = volumes;
  writeOutlineFile(dir, tree);
  return chapterIdByIndex;
}

/**
 * 逐章导入正文（**全量**：每片一个章节点文档行，不受 scope 限制）。
 * 段落块来自该章的真实切片文本；`content_text` 从块重算。
 * @returns 导入的章数
 */
function importChapterDocuments(
  db: Db,
  split: SplitWithSlices,
  chapterIdByIndex: ReadonlyMap<number, string>,
  now: string,
): number {
  let imported = 0;
  for (const slice of split.slices) {
    const chapterId = chapterIdByIndex.get(slice.index);
    // 切片与章列表同源（同一份块几何）⇒ 缺映射 = 调用方传错（静默跳过会丢正文）
    if (chapterId === undefined) throw new Error(`importChapterDocuments: 章序 ${slice.index} 没有对应的大纲节点`);
    const blocks = paragraphBlocksOf(split.text.slice(slice.start, slice.end));
    upsertDocument(db, {
      ownerKind: "chapter",
      ownerId: chapterId,
      content: JSON.stringify(blocks),
      contentText: blocksToPlainMd(blocks),
      now,
    });
    imported++;
  }
  return imported;
}

/**
 * S1 建档（同步、不调 LLM）：建大纲 → 导入正文 → 落 job 与批规划行 → job 置 `running`
 *（契约：S1 完成后才返回，返回时 job 已进入 `running`；批执行归 S2 runner）。
 *
 * 批规划 = `planBatches(scopedChapters)`（与 analyze 预估同一实现，确定性）**再经预算守卫**
 * （`budget` 给定时按模型两侧上限拆批，§4）；批行 `chapter_ids` 按章序映射为章节点 id。
 */
export function ingestDecomposeProject(input: IngestDecomposeProjectInput): IngestDecomposeProjectResult {
  const { project, split, now } = input;
  const chapterIdByIndex = writeOutlineFromSplit(project.root, split, now);
  importChapterDocuments(project.db, split, chapterIdByIndex, now);
  return createRunningJob(project, {
    batches: planBatchRows(input.scopedChapters, chapterIdByIndex, input.budget ?? null),
    scopeStart: input.scopeStart,
    scopeEnd: input.scopeEnd,
    concurrency: input.concurrency,
    model: input.model,
    now,
  });
}

/** 续拆启动入参（S1'：不建大纲、不导正文、不吃源文件） */
export interface ContinueDecomposeInput {
  project: ProjectContext;
  /** 范围过滤后的章（= 批规划输入；章序必须落在库内章序上） */
  scopedChapters: readonly SplitChapter[];
  scopeStart: number;
  scopeEnd: number;
  /** 本次使用的模型（`provider/id`，审计用）；未配置 → null */
  model: string | null;
  /** 并发段数快照（建 job 时由调用方读创作根配置一次，见 `decompose/config.ts`） */
  concurrency: number;
  /** 批大小预算（同 `IngestDecomposeProjectInput.budget`；缺省 = 只有结构组批） */
  budget?: DecomposeBatchBudget | null;
  now: string;
}

/**
 * S1'（续拆）：**只**落 job 行 + 批规划行——不建大纲、不导正文、不动 `outline.json` / `document_records`
 *（正文是 S1 全量导入的一次性产物，设计 §7.1）；随后 job 置 `running`，批执行归 S2 runner（与 start 同款）。
 */
export function ingestDecomposeContinue(input: ContinueDecomposeInput): IngestDecomposeProjectResult {
  const chapterIdByIndex = new Map(
    deriveChapterOrder(input.project.root).map((entry) => [entry.chapterNumber, entry.chapterId]),
  );
  return createRunningJob(input.project, {
    batches: planBatchRows(input.scopedChapters, chapterIdByIndex, input.budget ?? null),
    scopeStart: input.scopeStart,
    scopeEnd: input.scopeEnd,
    concurrency: input.concurrency,
    model: input.model,
    now: input.now,
  });
}

/**
 * 批规划行（章序 → 批行 `chapter_ids`）：缺映射 = 调用方传错（静默跳过会丢章）。
 * 预算给定时走 `planBatchesWithinBudget`（结构组批后再按预算细分，章为最小单位）；
 * 未给定（模型元数据不可用 / 直接建档的调用方）→ 结构组批，与预览预估同一实现。
 */
function planBatchRows(
  scopedChapters: readonly SplitChapter[],
  chapterIdByIndex: ReadonlyMap<number, string>,
  budget: DecomposeBatchBudget | null,
): Array<{ seq: number; chapterIds: string[] }> {
  const plans = budget === null ? planBatches(scopedChapters) : planBatchesWithinBudget(scopedChapters, budget);
  return plans.map((plan, position) => ({
    seq: position + 1,
    chapterIds: plan.chapterIndexes.map((chapterIndex) => {
      const chapterId = chapterIdByIndex.get(chapterIndex);
      if (chapterId === undefined) throw new Error(`拆解批规划：章序 ${chapterIndex} 没有对应的大纲节点`);
      return chapterId;
    }),
  }));
}

/**
 * 落 job 行 + 全部批行（同一事务，`createDecomposeJob`）并置 `running` —— S1 与 S1' 的公共尾段
 * （两处各写一遍必漂移）。
 */
function createRunningJob(
  project: ProjectContext,
  input: {
    batches: Array<{ seq: number; chapterIds: string[] }>;
    scopeStart: number;
    scopeEnd: number;
    concurrency: number;
    model: string | null;
    now: string;
  },
): IngestDecomposeProjectResult {
  const job = createDecomposeJob(project.db, {
    scopeStart: input.scopeStart,
    scopeEnd: input.scopeEnd,
    batchTargetChars: DECOMPOSE_BATCH_TARGET_CHARS,
    concurrency: input.concurrency,
    model: input.model,
    batches: input.batches,
    now: input.now,
  });
  updateJobStatus(project.db, job.id, "running", input.now);
  return { jobId: job.id, batchCount: input.batches.length };
}

// ============ 续拆预览（GET /decompose/plan 与 POST /decompose/continue 共用的库内事实） ============

/** 续拆后的章条目（章序 = `deriveChapterOrder` 的文件位置序；`charCount` = 正文投影长度） */
export interface DecomposeChapterEntry {
  index: number;
  title: string;
  charCount: number;
  volumeIndex: number;
  decomposed: boolean;
}

/** 续拆预览的库内事实：全书章（含已拆标记）+ 未拆章最小覆盖区间 */
export interface DecomposeProjectPlan {
  chapters: DecomposeChapterEntry[];
  /** 未拆章总数（全书口径） */
  remainingCount: number;
  /** 未拆章最小覆盖区间；无未拆章 → 0 / 0 */
  defaultScopeStart: number;
  defaultScopeEnd: number;
}

/**
 * 已拆章集合 = 历史上**所有** job 的 `done` 批覆盖的章并集（设计 §7.1；`failed` / 未完成批不算）。
 * 历史 job 全留在 `data.db`（进度面只显最新），故扫全量 job 行。
 */
function decomposedChapterIds(db: Db): Set<string> {
  const ids = new Set<string>();
  for (const job of listDecomposeJobs(db)) {
    for (const batch of listDecomposeBatches(db, job.id)) {
      if (batch.status !== "done") continue;
      for (const chapterId of batch.chapter_ids) ids.add(chapterId);
    }
  }
  return ids;
}

/**
 * 库内章清单（顺序 = `deriveChapterOrder`：root → 卷 → 章先序遍历）+ 已拆标记 + 缺省范围。
 * plan 与 continue **共用同一读取面**（各扫一遍必然漂移：预览说要拆的章与实际落的批不一致）。
 * `volumeIndex` = root 下的卷序号（卷序号从 0 起、单卷与存量直挂 root 的章均为 0——与切分的口径同形）。
 */
export function readDecomposeProjectPlan(project: ProjectContext): DecomposeProjectPlan {
  const decomposed = decomposedChapterIds(project.db);
  const entries: Array<{ id: string; title: string; volumeIndex: number }> = [];
  let volumeIndex = 0;
  for (const child of readOutlineFile(project.root).children) {
    if (child.type === "chapter") {
      entries.push({ id: child.id, title: child.title, volumeIndex: 0 });
      continue;
    }
    const index = volumeIndex++;
    for (const chapter of child.children ?? []) {
      entries.push({ id: chapter.id, title: chapter.title, volumeIndex: index });
    }
  }
  const textLengthById = getDocumentTextLengths(project.db, "chapter", entries.map((entry) => entry.id));
  const chapters: DecomposeChapterEntry[] = entries.map((entry, position) => ({
    index: position + 1,
    title: entry.title,
    charCount: textLengthById.get(entry.id) ?? 0,
    volumeIndex: entry.volumeIndex,
    decomposed: decomposed.has(entry.id),
  }));
  const remaining = chapters.filter((chapter) => !chapter.decomposed);
  return {
    chapters,
    remainingCount: remaining.length,
    defaultScopeStart: remaining[0]?.index ?? 0,
    defaultScopeEnd: remaining[remaining.length - 1]?.index ?? 0,
  };
}

/** 批是否已收口（`done` / `failed` 都不再跑）——阶段推导与进度统计共用 */
function isSettledBatch(batch: DecomposeBatchRow): boolean {
  return batch.status === "done" || batch.status === "failed";
}

/**
 * 已完成批的抽取结果（续拆重建本轮累积、S3 归并都读它）。
 * db 层不校验 `result` 形状（`[1,2]` 这类值原样透出）⇒ 此处按契约 schema 守卫。
 */
export function doneBatchResults(db: Db, jobId: string, doneSeqs: readonly number[]): DecomposeBatchResult[] {
  const results: DecomposeBatchResult[] = [];
  for (const seq of doneSeqs) {
    const parsed = decomposeBatchResultSchema.safeParse(getDecomposeBatch(db, jobId, seq)?.result);
    if (parsed.success) results.push(parsed.data);
  }
  return results;
}

/**
 * 阶段推导（表里没有 stage 列 ⇒ 从 job 状态 + 批收口度 + 归并清单反推，§8 阶段条）：
 * `done` → 全流程结束；`pending` → 建档中；**还有未收口批 → 逐章抽取**（单批重跑把 job 拉回
 * `running` 时阶段也随之回到 `extract`，§7）；批全部收口但归并清单还空 → 归并；清单非空 → 报告。
 */
function deriveStage(job: DecomposeJobRow, batches: readonly DecomposeBatchRow[]): DecomposeJobRes["stage"] {
  if (job.status === "done") return "done";
  if (job.status === "pending") return "ingest";
  if (!batches.every(isSettledBatch)) return "extract";
  return job.merge_written.length > 0 ? "report" : "merge";
}

/**
 * job 进度投影（GET /decompose/job）：**不含批结果正文**（数百批 × 每条千级 token 会撑爆响应，
 * 展开某批另取 `GET /job/batches/:seq`）。
 *
 * 批行的 `chapterIndexes` / `chapterTitles` 从章节点 id 反查（章序 = 文件位置序 = `deriveChapterOrder`；
 * 标题取大纲节点 title，与大纲页同源）；`charCount` = 该批各章正文投影长度和（与章列表 `textLength`
 * 同口径，不存快照）。
 *
 * `report` 从归并清单投影（S4 落盘后非 null）：报告实体 id 记在清单的 `reference` 条目上。
 */
export function buildJobResponse(project: ProjectContext, job: DecomposeJobRow): DecomposeJobRes {
  const batches = listDecomposeBatches(project.db, job.id);
  const chapterNumberById = new Map(deriveChapterOrder(project.root).map((entry) => [entry.chapterId, entry.chapterNumber]));
  const tree = readOutlineFile(project.root);
  const textLengthById = getDocumentTextLengths(project.db, "chapter", batches.flatMap((batch) => batch.chapter_ids));
  return {
    jobId: job.id,
    status: job.status,
    stage: deriveStage(job, batches),
    scopeStart: job.scope_start,
    scopeEnd: job.scope_end,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    progress: {
      done: batches.filter((batch) => batch.status === "done").length,
      failed: batches.filter((batch) => batch.status === "failed").length,
      total: batches.length,
    },
    batches: batches.map((batch) => {
      const chapterIndexes: number[] = [];
      const chapterTitles: string[] = [];
      let charCount = 0;
      for (const chapterId of batch.chapter_ids) {
        const chapterNumber = chapterNumberById.get(chapterId);
        // 章被物理删（回收站清除）后批行仍留着旧 id：跳过而不是报错（进度页照常显示其余章）
        if (chapterNumber === undefined) continue;
        chapterIndexes.push(chapterNumber);
        chapterTitles.push(findOutlineNode(tree, chapterId)?.title ?? "");
        charCount += textLengthById.get(chapterId) ?? 0;
      }
      return {
        seq: batch.seq,
        chapterIndexes,
        chapterTitles,
        charCount,
        status: batch.status,
        attempts: batch.attempts,
        error: batch.error,
      };
    }),
    error: job.error,
    report: reportProjection(project, job),
  };
}

/**
 * 拆解报告投影（§6.2）：报告实体 id 记在 `merge_written` 的 `reference` 条目上（S4 写入；重跑更新同一条
 * ⇒ 清单里恒至多一条）——按该 id 回读名字。实体被软删（用户丢进回收站）→ null（不报影子报告）。
 */
function reportProjection(project: ProjectContext, job: DecomposeJobRow): DecomposeJobRes["report"] {
  const entry = job.merge_written.find((item) => item.type === DECOMPOSE_REPORT_ENTITY_TYPE);
  if (entry === undefined) return null;
  const entity = getEntity(project.db, entry.id);
  return entity === null ? null : { entityId: entity.id, name: entity.name };
}
