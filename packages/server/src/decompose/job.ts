// 拆解 S1 建档 + job 骨架（卡 21.5）：建大纲（卷→章）→ 逐章导入正文段落块 → 落 job 与批规划行；
// 进度轮询（GET /decompose/job）的状态投影也在这里。
//
// 契约：docs/design/60-decompose.md §2（S1 建档）/ §4（范围与组批）/ §7（状态机）/ §8（进度面）；
// docs/api/120-api-decompose.md §start / §job / §batches；表不变式见 docs/db/schema.md「decompose 两表」。
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
  readOutlineFile,
  updateJobStatus,
  upsertDocument,
  writeOutlineFile,
  type Db,
  type DecomposeBatchRow,
  type DecomposeJobRow,
} from "@whispering233/ai-editor-db";
import { DECOMPOSE_BATCH_TARGET_CHARS, planBatches } from "./batching.js";
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
 * 批规划 = `planBatches(scopedChapters)`（与 analyze 预估同一实现，确定性）；批行 `chapter_ids`
 * 按章序映射为章节点 id。
 */
export function ingestDecomposeProject(input: IngestDecomposeProjectInput): IngestDecomposeProjectResult {
  const { project, split, now } = input;
  const chapterIdByIndex = writeOutlineFromSplit(project.root, split, now);
  importChapterDocuments(project.db, split, chapterIdByIndex, now);

  const batches = planBatches(input.scopedChapters).map((plan, position) => ({
    seq: position + 1,
    chapterIds: plan.chapterIndexes.map((chapterIndex) => {
      const chapterId = chapterIdByIndex.get(chapterIndex);
      if (chapterId === undefined) throw new Error(`ingestDecomposeProject: 章序 ${chapterIndex} 没有对应的大纲节点`);
      return chapterId;
    }),
  }));
  const job = createDecomposeJob(project.db, {
    scopeStart: input.scopeStart,
    scopeEnd: input.scopeEnd,
    batchTargetChars: DECOMPOSE_BATCH_TARGET_CHARS,
    model: input.model,
    batches,
    now,
  });
  updateJobStatus(project.db, job.id, "running", now);
  return { jobId: job.id, batchCount: batches.length };
}

/** 批是否已收口（`done` / `failed` 都不再跑）——阶段推导与进度统计共用 */
function isSettledBatch(batch: DecomposeBatchRow): boolean {
  return batch.status === "done" || batch.status === "failed";
}

/**
 * 已完成批的抽取结果（续拆重建滚动故事圣经、S3 归并都读它）。
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
