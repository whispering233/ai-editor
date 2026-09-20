// @whispering233/ai-editor-db 拆解小说 job / 批读写（卡 21.3）
//
// 契约：docs/db/schema.md「decompose_jobs / decompose_batches」（两表 DDL + 不变式表）、
// docs/design/60-decompose.md §7（状态机与续拆）、§6.1（merge_written 三路比对）。
// - **库写入唯一入口 = 本模块**（禁止绕过直接写表）；查询经 queryDb 取 drizzle 实例。
// - JSON 列（chapter_ids / result / merge_written）保持 **text 模式**，行映射层防御解析
//   （坏行 → 空数组 / null，与 entity.ts parseDataColumn 同口径）——坏 JSON 不得打挂查询。
// - 时间约定：ISO 8601 应用层写入（`now` 由调用方传入，模块内不生成时间）。
// - 状态字面量单一来源 = shared API 契约（`DecomposeJobRes` / `DecomposeBatchRes` 的状态投影），
//   本模块不复抄清单、DDL 也不加 CHECK。
// - 批行只由本模块写；批结果（`result`）是 S2 的暂存中间产物，业务表只由 S3 写。

import type { DecomposeBatchRes, DecomposeBatchResult, DecomposeJobRes } from "@whispering233/ai-editor-shared";
import { generateId } from "@whispering233/ai-editor-shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { withTransaction, type Db } from "../connection.js";
import { queryDb } from "../query-db.js";
import { decomposeBatches, decomposeJobs } from "../tables.js";

/** job id 前缀（api-public id 约定 `{前缀}-{nanoid}`；job 用 `job-`） */
export const DECOMPOSE_JOB_ID_PREFIX = "job-";

/** job 状态（pending → running → (paused | done | failed)） */
export type DecomposeJobStatus = DecomposeJobRes["status"];
/** 批状态（pending → running → done | failed） */
export type DecomposeBatchStatus = DecomposeBatchRes["status"];

/** `merge_written` 项（JSON 形状，字段名与库列同口径）——上次归并写入清单（实体 + 关系 + 报告） */
export interface DecomposeMergeWrittenEntry {
  id: string;
  type: string;
  /** 写入时的 `updated_at`（重跑三路比对的快照；变了 = 用户手工编辑过） */
  updated_at: string;
}

/** decompose_jobs 行（列名与 DDL 同形；`merge_written` 已解析为清单） */
export interface DecomposeJobRow {
  id: string;
  status: DecomposeJobStatus;
  scope_start: number;
  scope_end: number;
  batch_target_chars: number;
  model: string | null;
  merge_written: DecomposeMergeWrittenEntry[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** decompose_batches 行（**不含 result**——列表口径，批结果正文按需另取） */
export interface DecomposeBatchRow {
  job_id: string;
  seq: number;
  /** 本批覆盖的章节点 id 列表（顺序 = 文件序） */
  chapter_ids: string[];
  status: DecomposeBatchStatus;
  /** 已尝试次数 */
  attempts: number;
  error: string | null;
  updated_at: string;
}

/** 单批详情 = 批行 + 抽取结果（未完成 → null） */
export interface DecomposeBatchDetailRow extends DecomposeBatchRow {
  result: DecomposeBatchResult | null;
}

/** 创建 job 入参：范围/组批口径快照 + 批规划（S1 组批结果）；job 初始状态恒为 pending */
export interface CreateDecomposeJobInput {
  /** 分析范围起始章序（1-based，文件位置序） */
  scopeStart: number;
  scopeEnd: number;
  /** 组批目标字数快照（续拆/重跑按同一口径重算批次） */
  batchTargetChars: number;
  /** 本次使用的模型（provider/id，审计用）；未配置 → null */
  model: string | null;
  /** 批规划（seq 升序，各批的章 id 列表按文件序） */
  batches: readonly { seq: number; chapterIds: readonly string[] }[];
  now: string;
}

// ============ 行映射（JSON 列防御解析） ============

/** 解析 JSON 字符串数组（坏 JSON / 非数组 / 非字符串项 → 丢弃，返回空数组） */
function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 单项形状守卫（坏清单项丢弃，不阻断整行读取） */
function isMergeWrittenEntry(value: unknown): value is DecomposeMergeWrittenEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && typeof entry.type === "string" && typeof entry.updated_at === "string";
}

/** 解析 merge_written 清单（坏 JSON / 非数组 → 空数组 = 从未归并） */
function parseMergeWritten(value: unknown): DecomposeMergeWrittenEntry[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isMergeWrittenEntry) : [];
  } catch {
    return [];
  }
}

/**
 * 解析批抽取结果（坏 JSON / 非对象 → null = 未完成）。
 * 形状校验归 server 的抽取层（模型原始输出在落库前已归一），本包只保证**坏 JSON 不抛错**。
 */
function parseBatchResult(value: unknown): DecomposeBatchResult | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as DecomposeBatchResult) : null;
  } catch {
    return null;
  }
}

/** 行 → job 行（坏 JSON 防御见 parseMergeWritten） */
function toJobRow(row: Record<string, unknown>): DecomposeJobRow {
  return {
    id: row.id as string,
    status: row.status as DecomposeJobStatus,
    scope_start: row.scope_start as number,
    scope_end: row.scope_end as number,
    batch_target_chars: row.batch_target_chars as number,
    model: (row.model as string | null) ?? null,
    merge_written: parseMergeWritten(row.merge_written),
    error: (row.error as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** 行 → 批行（不含 result） */
function toBatchRow(row: Record<string, unknown>): DecomposeBatchRow {
  return {
    job_id: row.job_id as string,
    seq: row.seq as number,
    chapter_ids: parseStringArray(row.chapter_ids),
    status: row.status as DecomposeBatchStatus,
    attempts: row.attempts as number,
    error: (row.error as string | null) ?? null,
    updated_at: row.updated_at as string,
  };
}

// ============ job ============

/**
 * 创建 job 并落全部批行（S1 的组批结果）——**同一事务**：job 与批规划要么同时存在，要么都不存在。
 * job 初始状态 = `pending`（启动 = `updateJobStatus(status='running')`）；
 * 批行初始状态 = `pending`、`attempts = 0`、`result = NULL`。
 *
 * @returns 落库后的 job 行（id 由本模块生成，`job-` 前缀 + nanoid）
 */
export function createDecomposeJob(db: Db, input: CreateDecomposeJobInput): DecomposeJobRow {
  const id = generateId(DECOMPOSE_JOB_ID_PREFIX);
  withTransaction(db, () => {
    const q = queryDb(db);
    q.insert(decomposeJobs)
      .values({
        id,
        status: "pending",
        scope_start: input.scopeStart,
        scope_end: input.scopeEnd,
        batch_target_chars: input.batchTargetChars,
        model: input.model,
        merge_written: null,
        error: null,
        created_at: input.now,
        updated_at: input.now,
      })
      .run();
    if (input.batches.length > 0) {
      q.insert(decomposeBatches)
        .values(
          input.batches.map((batch) => ({
            job_id: id,
            seq: batch.seq,
            chapter_ids: JSON.stringify(batch.chapterIds),
            status: "pending",
            result: null,
            attempts: 0,
            error: null,
            updated_at: input.now,
          })),
        )
        .run();
    }
  });
  const row = selectJobRow(db, id);
  if (row === null) throw new Error(`createDecomposeJob: job ${id} 落库后读取失败`);
  return row;
}

/** 按 id 读 job 行（内部：创建后回读） */
function selectJobRow(db: Db, jobId: string): DecomposeJobRow | null {
  const row = queryDb(db).select().from(decomposeJobs).where(eq(decomposeJobs.id, jobId)).get() as
    | Record<string, unknown>
    | undefined;
  return row === undefined ? null : toJobRow(row);
}

/**
 * 读当前项目的 job（进度轮询、端点解析用）。
 * 一项目一 job 是业务层不变式（`docs/db/schema.md`）；多行时取最新创建的一条。
 * @returns 行对象；从未开始拆解 → null（端点侧 404 `DECOMPOSE_JOB_NOT_FOUND`）
 */
export function getDecomposeJob(db: Db): DecomposeJobRow | null {
  const row = queryDb(db)
    .select()
    .from(decomposeJobs)
    .orderBy(desc(decomposeJobs.created_at), desc(decomposeJobs.id))
    .limit(1)
    .get() as Record<string, unknown> | undefined;
  return row === undefined ? null : toJobRow(row);
}

/**
 * job 状态流转（pending → running → paused/done/failed；前置状态校验归端点/runner，
 * 状态字面量集见 `DecomposeJobStatus`）。同时推进 `updated_at`（进度轮询的时间戳）。
 * @returns 影响行数（0 = job 不存在）
 */
export function updateJobStatus(db: Db, jobId: string, status: DecomposeJobStatus, now: string): number {
  return queryDb(db)
    .update(decomposeJobs)
    .set({ status, updated_at: now })
    .where(eq(decomposeJobs.id, jobId))
    .run().changes;
}

/**
 * 写 job 级错误摘要（`null` = 清除，如续拆/重跑开工时）。
 * @returns 影响行数（0 = job 不存在）
 */
export function setJobError(db: Db, jobId: string, error: string | null, now: string): number {
  return queryDb(db)
    .update(decomposeJobs)
    .set({ error, updated_at: now })
    .where(eq(decomposeJobs.id, jobId))
    .run().changes;
}

/**
 * **状态归一**（打开项目时调用）：把残留的 `running` 改判为 `paused`——进程内已无在跑 job
 * （服务端重启 / 进程崩溃），UI 提示「上次拆解中断，可续拆」（`docs/design/60-decompose.md` §7）。
 *
 * 批行不动：续拆从第一个未完成批继续，`startBatchAttempt` 对残留 `running` 批同样成立
 * （重新计入一次尝试），无需单独归一。
 *
 * @returns 被归一的 job 条数（正常路径 0）
 */
export function pauseRunningJobs(db: Db, now: string): number {
  return queryDb(db)
    .update(decomposeJobs)
    .set({ status: "paused", updated_at: now })
    .where(eq(decomposeJobs.status, "running"))
    .run().changes;
}

/**
 * 写 `merge_written` 清单（上次归并写入的实体/关系/报告 id + 写入时 `updated_at`）——
 * 重跑 S3 的三路比对快照（§6.1）。
 * @returns 影响行数（0 = job 不存在）
 */
export function writeMergeWritten(
  db: Db,
  jobId: string,
  entries: readonly DecomposeMergeWrittenEntry[],
  now: string,
): number {
  return queryDb(db)
    .update(decomposeJobs)
    .set({ merge_written: JSON.stringify(entries), updated_at: now })
    .where(eq(decomposeJobs.id, jobId))
    .run().changes;
}

/**
 * 删除 job 及其全部批行（**同事务**；无外键，孤儿批行只能由本函数拦住）。
 * 用于清场重来（重跑整套 / 重置拆解）；删整本书走书目录删除、不经过本函数。
 * @returns 删除的总行数（job 1 + 批 N；不存在 → 0，幂等）
 */
export function deleteDecomposeJob(db: Db, jobId: string): number {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const batches = q.delete(decomposeBatches).where(eq(decomposeBatches.job_id, jobId)).run().changes;
    const jobs = q.delete(decomposeJobs).where(eq(decomposeJobs.id, jobId)).run().changes;
    return jobs + batches;
  });
}

// ============ 批 ============

/**
 * 读某 job 的批列表（**不含 `result`**，按 `seq` 升序）。
 * 列表口径投影：不 SELECT `result`——数百批 × 每条千级 token 的结果正文不得进列表响应。
 */
export function listDecomposeBatches(db: Db, jobId: string): DecomposeBatchRow[] {
  const rows = queryDb(db)
    .select({
      job_id: decomposeBatches.job_id,
      seq: decomposeBatches.seq,
      chapter_ids: decomposeBatches.chapter_ids,
      status: decomposeBatches.status,
      attempts: decomposeBatches.attempts,
      error: decomposeBatches.error,
      updated_at: decomposeBatches.updated_at,
    })
    .from(decomposeBatches)
    .where(eq(decomposeBatches.job_id, jobId))
    .orderBy(asc(decomposeBatches.seq))
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map(toBatchRow);
}

/** 读单批（含 `result`）——进度页展开行时按需拉取；批序号越界 → null（端点侧 404） */
export function getDecomposeBatch(db: Db, jobId: string, seq: number): DecomposeBatchDetailRow | null {
  const row = queryDb(db)
    .select()
    .from(decomposeBatches)
    .where(and(eq(decomposeBatches.job_id, jobId), eq(decomposeBatches.seq, seq)))
    .get() as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return { ...toBatchRow(row), result: parseBatchResult(row.result) };
}

/**
 * 开始一次尝试：批状态 → `running`、`attempts` 自增、清上一条错误摘要。
 * 对 `pending` / `failed` / 残留 `running` 同样成立（续拆重取同一批即新一轮尝试）。
 * @returns 自增后的尝试序号；批不存在 → null
 */
export function startBatchAttempt(db: Db, jobId: string, seq: number, now: string): number | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const changes = q
      .update(decomposeBatches)
      .set({ status: "running", attempts: sql`${decomposeBatches.attempts} + 1`, error: null, updated_at: now })
      .where(and(eq(decomposeBatches.job_id, jobId), eq(decomposeBatches.seq, seq)))
      .run().changes;
    if (changes === 0) return null;
    const row = q
      .select({ attempts: decomposeBatches.attempts })
      .from(decomposeBatches)
      .where(and(eq(decomposeBatches.job_id, jobId), eq(decomposeBatches.seq, seq)))
      .get();
    return row?.attempts ?? null;
  });
}

/** 批完成：抽取结果落库、状态 → `done`、清错误摘要 */
export function completeBatch(
  db: Db,
  input: { jobId: string; seq: number; result: DecomposeBatchResult; now: string },
): number {
  return queryDb(db)
    .update(decomposeBatches)
    .set({ status: "done", result: JSON.stringify(input.result), error: null, updated_at: input.now })
    .where(and(eq(decomposeBatches.job_id, input.jobId), eq(decomposeBatches.seq, input.seq)))
    .run().changes;
}

/**
 * 批失败：状态 → `failed` + 失败摘要；`result` 置 **NULL**（契约口径「未完成 = NULL」——
 * 重跑失败后不得留着上一轮结果冒充本批产物）。
 */
export function failBatch(
  db: Db,
  input: { jobId: string; seq: number; error: string; now: string },
): number {
  return queryDb(db)
    .update(decomposeBatches)
    .set({ status: "failed", result: null, error: input.error, updated_at: input.now })
    .where(and(eq(decomposeBatches.job_id, input.jobId), eq(decomposeBatches.seq, input.seq)))
    .run().changes;
}
