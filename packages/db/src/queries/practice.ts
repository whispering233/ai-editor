// @whispering233/ai-editor-db 文风仿写练习读写（practice_targets / practice_samples，2026-10）
//
// 练习工作区（`kind = "practice"`）专属数据：**库写入唯一入口 = 本模块**（禁止绕过直接写表）。
// 语义与不变式见 `docs/design/60-practice.md` §3、`docs/design/10-data-model.md` §16；
// 字段契约见 `docs/db/schema.md`；响应形状见 `docs/api/120-api-practice.md`。
//
// 口径（与文档逐条对应）：
// - **物理删**：练习数据无回收站（无 deleted_at）；删目标**级联删该目标下全部样本**
// - **范文不可变**：`text` 只在建样本时落库，无更新入口
// - **用户稿唯一写入口** = updatePracticeDraft；**点评只由工具写**（本卡不提供 `feedback` 写入口）
// - **无外键**：`target_id` 的存在性由本层守卫（建样本/列样本时目标不存在 → 返回 null）
// - **列表只出投影**：样本列表不回正文与卡体（`charCount` 走 SQL `length(text)`，不把范文拉进内存；
//   `feedback` 只读出用于判定 `hasFeedback`，不进返回值）
// - **JSON 列防御解析**：`feedback` text 模式（不用 drizzle `mode:'json'`），坏值按 null
//
// 返回值形态沿用 db 包既有口径：**详情/写入 = 存储形态行（snake_case）**、
// **列表 = API 投影形状（camelCase，同 EntitySummary 先例）**——列表投影是 db 侧派生
// （charCount / hasDraft / hasFeedback / sampleCount），不由调用方复算。

import { asc, count, desc, eq, sql } from "drizzle-orm";
import { generateId } from "@whispering233/ai-editor-shared";
import { withTransaction, type Db } from "../connection.js";
import { nowIso } from "../storage/atomic.js";
import { queryDb } from "../query-db.js";
import { practiceSamples, practiceTargets } from "../tables.js";

/** 范文来源种类：MVP 唯一值 `paste`（跨工作区快照导入为升级路径，见 backlog） */
export type PracticeSourceKind = "paste";

/** 点评卡（AI 产出；结构见 docs/design/60-practice.md §4）——本层不校验卡体，只做 JSON 防御解析 */
export type PracticeFeedback = Record<string, unknown>;

/** practice_targets 行（存储形态；observation 为 NULL = 用户没写观察） */
export interface PracticeTargetRow {
  id: string; // 'pt-*'
  name: string;
  observation: string | null;
  created_at: string;
  updated_at: string;
}

/** practice_samples 行（存储形态；feedback 已防御解析，坏值为 null） */
export interface PracticeSampleRow {
  id: string; // 'ps-*'
  target_id: string;
  source_kind: PracticeSourceKind;
  source_label: string;
  text: string;
  draft: string;
  feedback: PracticeFeedback | null;
  created_at: string;
  updated_at: string;
}

/** 目标列表项（API 投影形状：与 `GET /practice/targets` 响应一致，含样本数） */
export interface PracticeTargetSummary {
  id: string;
  name: string;
  observation: string | null;
  sampleCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 样本列表项（API 投影形状：与 `GET /practice/targets/:id/samples` 响应一致，**不含正文与卡体**） */
export interface PracticeSampleSummary {
  id: string;
  sourceKind: PracticeSourceKind;
  sourceLabel: string;
  charCount: number; // 范文快照字符数（SQL length(text)，不返回正文）
  hasDraft: boolean;
  hasFeedback: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 解析 `feedback` 列（防御解析，同 entity.ts parseDataColumn 先例）：
 * 非法 JSON / 非对象（含数组） / `null` 一律按 null——否则单条坏行会打挂详情读取。
 * 坏值不静默写回（修复入口 = 重跑点评，见 docs/api/120-api-practice.md）。
 */
function parseFeedbackColumn(value: unknown): PracticeFeedback | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as PracticeFeedback;
  } catch {
    return null;
  }
}

/** 行 → PracticeTargetRow（列名直映射；无 JSON 列） */
function rowToTargetRow(row: Record<string, unknown>): PracticeTargetRow {
  return {
    id: row.id as string,
    name: row.name as string,
    observation: (row.observation as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** 行 → PracticeSampleRow（feedback 防御解析） */
function rowToSampleRow(row: Record<string, unknown>): PracticeSampleRow {
  return {
    id: row.id as string,
    target_id: row.target_id as string,
    source_kind: row.source_kind as PracticeSourceKind,
    source_label: row.source_label as string,
    text: row.text as string,
    draft: row.draft as string,
    feedback: parseFeedbackColumn(row.feedback),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * 观察文本归一：**空串 = 清空（写 NULL）**（口径见 `docs/api/120-api-practice.md`
 * 的 PUT 请求；收在写入侧，避免调用方各写一份 `"" → null`）。
 */
function normalizeObservation(observation: string | null | undefined): string | null {
  return observation === undefined || observation === null || observation === "" ? null : observation;
}

// ============ 文风目标 ============

/**
 * 文风目标列表（`GET /practice/targets`）：按 `updated_at` 倒序（同值用 id 升序作稳定次序，
 * 避免同毫秒写入的列表顺序不稳定），并附该目标下的样本数（LEFT JOIN 计数，无样本 = 0）。
 */
export function listPracticeTargets(db: Db): PracticeTargetSummary[] {
  const rows = queryDb(db)
    .select({
      id: practiceTargets.id,
      name: practiceTargets.name,
      observation: practiceTargets.observation,
      sampleCount: count(practiceSamples.id),
      createdAt: practiceTargets.created_at,
      updatedAt: practiceTargets.updated_at,
    })
    .from(practiceTargets)
    .leftJoin(practiceSamples, eq(practiceSamples.target_id, practiceTargets.id))
    .groupBy(practiceTargets.id)
    .orderBy(desc(practiceTargets.updated_at), asc(practiceTargets.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    observation: row.observation ?? null,
    sampleCount: row.sampleCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 按 id 取目标（详情 / 存在性守卫；不存在返回 null） */
export function getPracticeTarget(db: Db, id: string): PracticeTargetRow | null {
  const row = queryDb(db).select().from(practiceTargets).where(eq(practiceTargets.id, id)).get() as unknown as
    | Record<string, unknown>
    | undefined;
  return row === undefined ? null : rowToTargetRow(row);
}

/**
 * 新建目标（`POST /practice/targets`）：id = `pt-` + nanoid、created_at = updated_at = 写入时刻、
 * `observation` 缺省/空串一律存 NULL。
 * @returns 新行（存储形态）
 */
export function createPracticeTarget(
  db: Db,
  input: { name: string; observation?: string | null },
): PracticeTargetRow {
  const now = nowIso();
  const row: PracticeTargetRow = {
    id: generateId("pt-"),
    name: input.name,
    observation: normalizeObservation(input.observation),
    created_at: now,
    updated_at: now,
  };
  queryDb(db)
    .insert(practiceTargets)
    .values({
      id: row.id,
      name: row.name,
      observation: row.observation,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    .run();
  return row;
}

/**
 * 部分更新目标（`PUT /practice/targets/:id`）：仅覆盖传入字段（`undefined` = 不动）、
 * `updated_at` 推进。读后写包 withTransaction（同 updateEntity 口径）。
 * @returns 更新后的行；目标不存在返回 null（路由层映射 404）
 */
export function updatePracticeTarget(
  db: Db,
  id: string,
  patch: { name?: string; observation?: string | null },
): PracticeTargetRow | null {
  return withTransaction(db, () => {
    const existing = getPracticeTarget(db, id);
    if (existing === null) return null;
    const next: PracticeTargetRow = {
      ...existing,
      name: patch.name ?? existing.name,
      observation: patch.observation === undefined ? existing.observation : normalizeObservation(patch.observation),
      updated_at: nowIso(),
    };
    queryDb(db)
      .update(practiceTargets)
      .set({ name: next.name, observation: next.observation, updated_at: next.updated_at })
      .where(eq(practiceTargets.id, id))
      .run();
    return next;
  });
}

/**
 * 删除目标（`DELETE /practice/targets/:id`）：**物理删 + 级联删该目标下全部样本**，
 * 同一事务内先删样本、再删目标（无外键，顺序只为可读性与计数口径）。
 * @returns `{ deleted: true, deletedSamples }`；目标不存在返回 null（路由层映射 404）
 */
export function deletePracticeTarget(db: Db, id: string): { deleted: true; deletedSamples: number } | null {
  return withTransaction(db, () => {
    if (getPracticeTarget(db, id) === null) return null;
    const deletedSamples = queryDb(db)
      .delete(practiceSamples)
      .where(eq(practiceSamples.target_id, id))
      .run().changes;
    queryDb(db).delete(practiceTargets).where(eq(practiceTargets.id, id)).run();
    return { deleted: true, deletedSamples };
  });
}

// ============ 练习样本 ============

/**
 * 某目标下的样本列表（`GET /practice/targets/:id/samples`）：按 `updated_at` 倒序
 * （同值用 id 升序作稳定次序）、**只出投影列**——范文正文与卡体不进内存（charCount 走 SQL）。
 *
 * `hasDraft` = `draft <> ''`（SQL 判定，范本与稿件正文不进内存）；`hasFeedback` = 点评卡**防御解析后非 null**
 * ——与详情同口径：坏 JSON 行在列表与详情一致地呈现为「未点评」（故本查询读出 `feedback` 列但不出现在返回值里）。
 * @returns 样本投影列表；目标不存在返回 null（路由层映射 404）
 */
export function listPracticeSamples(db: Db, targetId: string): PracticeSampleSummary[] | null {
  if (getPracticeTarget(db, targetId) === null) return null;
  const rows = queryDb(db)
    .select({
      id: practiceSamples.id,
      sourceKind: practiceSamples.source_kind,
      sourceLabel: practiceSamples.source_label,
      charCount: sql<number>`length(${practiceSamples.text})`,
      hasDraft: sql<number>`(${practiceSamples.draft} <> '')`,
      feedback: practiceSamples.feedback,
      createdAt: practiceSamples.created_at,
      updatedAt: practiceSamples.updated_at,
    })
    .from(practiceSamples)
    .where(eq(practiceSamples.target_id, targetId))
    .orderBy(desc(practiceSamples.updated_at), asc(practiceSamples.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    sourceKind: row.sourceKind as PracticeSourceKind,
    sourceLabel: row.sourceLabel,
    charCount: row.charCount,
    hasDraft: row.hasDraft === 1,
    hasFeedback: parseFeedbackColumn(row.feedback) !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 按 id 取样本详情（`GET /practice/samples/:id`；含范文全文、稿件与防御解析后的点评卡）；不存在返回 null */
export function getPracticeSample(db: Db, id: string): PracticeSampleRow | null {
  const row = queryDb(db).select().from(practiceSamples).where(eq(practiceSamples.id, id)).get() as unknown as
    | Record<string, unknown>
    | undefined;
  return row === undefined ? null : rowToSampleRow(row);
}

/**
 * 新建样本（`POST /practice/targets/:id/samples`）：id = `ps-` + nanoid、`draft` = 空串、
 * `feedback` = NULL、created_at = updated_at = 写入时刻。`source_kind` 缺省 `paste`。
 * @returns 新行（存储形态）；目标不存在返回 null（路由层映射 404）
 */
export function createPracticeSample(
  db: Db,
  input: { targetId: string; sourceLabel: string; text: string; sourceKind?: PracticeSourceKind },
): PracticeSampleRow | null {
  return withTransaction(db, () => {
    if (getPracticeTarget(db, input.targetId) === null) return null;
    const now = nowIso();
    const row: PracticeSampleRow = {
      id: generateId("ps-"),
      target_id: input.targetId,
      source_kind: input.sourceKind ?? "paste",
      source_label: input.sourceLabel,
      text: input.text,
      draft: "",
      feedback: null,
      created_at: now,
      updated_at: now,
    };
    queryDb(db)
      .insert(practiceSamples)
      .values({
        id: row.id,
        target_id: row.target_id,
        source_kind: row.source_kind,
        source_label: row.source_label,
        text: row.text,
        draft: row.draft,
        feedback: null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
      .run();
    return row;
  });
}

/**
 * 保存仿写稿（`PUT /practice/samples/:id`）——**全系统唯一的用户写稿入口**（AI 工具面没有写稿工具）。
 * 整体覆盖 `draft`（允许空串 = 清空稿件），推进 `updated_at`；范文 `text` 与 `feedback` 一概不动。
 * 并发口径 = 后写覆盖（不带版本戳，同结构化数据/参考资料）。
 * @returns `{ updatedAt }`（版本戳）；样本不存在返回 null（路由层映射 404）
 */
export function updatePracticeDraft(db: Db, id: string, draft: string): { updatedAt: string } | null {
  return withTransaction(db, () => {
    if (getPracticeSample(db, id) === null) return null;
    const updatedAt = nowIso();
    queryDb(db).update(practiceSamples).set({ draft, updated_at: updatedAt }).where(eq(practiceSamples.id, id)).run();
    return { updatedAt };
  });
}

/**
 * 删除样本（`DELETE /practice/samples/:id`）：物理删（练习数据无回收站），行随目标存续独立。
 * @returns 是否删掉了行（false = 样本不存在，路由层映射 404）
 */
export function deletePracticeSample(db: Db, id: string): boolean {
  return queryDb(db).delete(practiceSamples).where(eq(practiceSamples.id, id)).run().changes > 0;
}
