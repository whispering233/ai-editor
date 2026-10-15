// @whispering233/ai-editor-db 作家文风练习读写（practice_samples / practice_free_pieces /
// practice_style_packs，2026-10 改版）
//
// 练习工作区（`kind = "practice"`，一位预置作家 = 一个工作区）专属数据：
// **库写入唯一入口 = 本模块**（禁止绕过直接写表）。语义与不变式见 `docs/design/60-practice.md` §5、
// 字段契约见 `docs/db/schema.md`「练习三表」、响应形状见 `docs/api/120-api-practice.md`。
//
// 口径（与文档逐条对应）：
// - **物理删**：练习数据无回收站（无 deleted_at）；删除幂等（不存在 → null / false，不抛错）
// - **范文不可变**：`text` 只在建样本时落库，无更新入口
// - **每列只有一个写入口**：`draft` 只有用户（updatePracticeSampleDraft / updatePracticePieceDraft）、
//   `feedback` 只有提交点评工具（updatePracticeFeedback / updatePracticePieceFeedback）、
//   `topic` / `brief` 只有出题工具（updatePracticePieceTopic）
// - **无外键、无索引**：`work_id` 的存在性由写入侧按 shared 预置作品清单守卫；单工作区数据量小、列表全扫
// - **列表只出投影**：不回正文 / 稿件 / 卡体（`charCount` 走 SQL `length(...)`，不把长文拉进内存；
//   `feedback` 只读出用于判定 `hasFeedback`，不进返回值）
// - **JSON 列防御解析**：`feedback` text 模式（不用 drizzle `mode:'json'`），坏值按 null
// - **素材包只存用户覆盖**：无覆盖 = 无行（读侧回退 shared 预置常量），删行 = 恢复预置
//
// 返回值形态沿用 db 包既有口径：**详情 / 写入 = 存储形态行（snake_case）**、
// **列表 = API 投影形状（camelCase，同 EntitySummary 先例）**——列表投影是 db 侧派生
// （charCount / hasDraft / hasFeedback），不由调用方复算。

import { asc, desc, eq, sql } from "drizzle-orm";
import { generateId } from "@whispering233/ai-editor-shared";
import { withTransaction, type Db } from "../connection.js";
import { nowIso } from "../storage/atomic.js";
import { queryDb } from "../query-db.js";
import { practiceFreePieces, practiceSamples, practiceStylePacks } from "../tables.js";

/** 自由练习篇的题目来源（用户自拟 / AI 出题；空题目 + `ai` = 待出题状态） */
export type PracticeTopicSource = "user" | "ai";

/** 点评卡（AI 产出；结构见 docs/design/60-practice.md §6）——本层不校验卡体，只做 JSON 防御解析 */
export type PracticeFeedback = Record<string, unknown>;

/** practice_samples 行（存储形态；`work_id` 为 NULL = 「其他」，`feedback` 已防御解析） */
export interface PracticeSampleRow {
  id: string; // 'ps-*'
  work_id: string | null;
  excerpt_label: string;
  text: string;
  draft: string;
  feedback: PracticeFeedback | null;
  created_at: string;
  updated_at: string;
}

/** practice_free_pieces 行（存储形态；空 `topic` = 待出题） */
export interface PracticePieceRow {
  id: string; // 'pf-*'
  topic: string;
  brief: string;
  topic_source: PracticeTopicSource;
  draft: string;
  feedback: PracticeFeedback | null;
  created_at: string;
  updated_at: string;
}

/** practice_style_packs 行（存储形态；无行 = 无用户覆盖） */
export interface PracticeStylePackRow {
  author_id: string;
  content: string;
  updated_at: string;
}

/** 样本列表项（API 投影形状：与 `GET /practice/samples` 响应一致，**不含正文与卡体**） */
export interface PracticeSampleSummary {
  id: string;
  workId: string | null;
  excerptLabel: string;
  charCount: number; // 范文快照字符数（SQL length(text)，不返回正文）
  hasDraft: boolean;
  hasFeedback: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 自由练习列表项（API 投影形状：与 `GET /practice/free` 响应一致，**不含稿件与卡体**） */
export interface PracticePieceSummary {
  id: string;
  topic: string;
  brief: string;
  topicSource: PracticeTopicSource;
  charCount: number; // 稿件字符数（SQL length(draft)）
  hasDraft: boolean;
  hasFeedback: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 解析 `feedback` 列（防御解析，同 entity.ts parseDataColumn 先例）：
 * 非法 JSON / 非对象（含数组 / JSON `null`）一律按 null——否则单条坏行会打挂读取；
 * **合法 JSON 对象一律原样返回**（含 `{}`——**卡内形状校验在写入侧**，读侧不做形状特判）。
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

/** 行映射：列名直映射（同 DDL）+ `feedback` 防御解析 */
function toSampleRow(row: { feedback: string | null } & Omit<PracticeSampleRow, "feedback">): PracticeSampleRow {
  return { ...row, feedback: parseFeedbackColumn(row.feedback) };
}

/** 行映射：列名直映射（同 DDL）+ `feedback` 防御解析 */
function toPieceRow(
  row: { topic_source: string; feedback: string | null } & Omit<PracticePieceRow, "topic_source" | "feedback">,
): PracticePieceRow {
  return { ...row, topic_source: row.topic_source as PracticeTopicSource, feedback: parseFeedbackColumn(row.feedback) };
}

// ============ 范文样本（practice_samples） ============

/**
 * 全工作区样本列表（`GET /practice/samples`）：按 `updated_at` 倒序（同值用 id 升序作稳定次序，
 * 避免同毫秒写入的列表顺序不稳定）、**只出投影列**——范文正文与卡体不进内存（charCount 走 SQL）。
 *
 * `hasDraft` = `draft <> ''`（SQL 判定）；`hasFeedback` = 点评卡**防御解析后非 null**——
 * 与详情同口径：坏 JSON 行在列表与详情一致地呈现为「未点评」（故本查询读出 `feedback` 列但不进返回值）。
 */
export function listPracticeSamples(db: Db): PracticeSampleSummary[] {
  const rows = queryDb(db)
    .select({
      id: practiceSamples.id,
      workId: practiceSamples.work_id,
      excerptLabel: practiceSamples.excerpt_label,
      charCount: sql<number>`length(${practiceSamples.text})`,
      hasDraft: sql<number>`(${practiceSamples.draft} <> '')`,
      feedback: practiceSamples.feedback,
      createdAt: practiceSamples.created_at,
      updatedAt: practiceSamples.updated_at,
    })
    .from(practiceSamples)
    .orderBy(desc(practiceSamples.updated_at), asc(practiceSamples.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    workId: row.workId ?? null,
    excerptLabel: row.excerptLabel,
    charCount: row.charCount,
    hasDraft: row.hasDraft === 1,
    hasFeedback: parseFeedbackColumn(row.feedback) !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 按 id 取样本详情（`GET /practice/samples/:id`；含范文全文、稿件与防御解析后的点评卡）；不存在返回 null */
export function getPracticeSample(db: Db, id: string): PracticeSampleRow | null {
  const row = queryDb(db).select().from(practiceSamples).where(eq(practiceSamples.id, id)).get();
  return row === undefined ? null : toSampleRow(row);
}

/**
 * 新建样本（`POST /practice/samples`）：id = `ps-` + nanoid、`draft` = 空串、`feedback` = NULL、
 * created_at = updated_at = 写入时刻。`work_id` 缺省 / null = 「其他」（存在性校验在写入侧 = 路由 schema）；
 * `excerpt_label` 缺省 = 空串。**范文 `text` 落库后不可变**（无更新入口）。
 * @returns 新行（存储形态）
 */
export function createPracticeSample(
  db: Db,
  input: { workId?: string | null; excerptLabel?: string; text: string },
): PracticeSampleRow {
  const now = nowIso();
  const row: PracticeSampleRow = {
    id: generateId("ps-"),
    work_id: input.workId ?? null,
    excerpt_label: input.excerptLabel ?? "",
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
      work_id: row.work_id,
      excerpt_label: row.excerpt_label,
      text: row.text,
      draft: row.draft,
      feedback: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    .run();
  return row;
}

/**
 * 保存仿写稿（`PUT /practice/samples/:id`）——样本侧**唯一的用户写稿入口**（AI 工具面没有写稿工具）。
 * 整体覆盖 `draft`（允许空串 = 清空稿件），推进 `updated_at`；范文 `text` 与 `feedback` 一概不动。
 * 并发口径 = 后写覆盖（不带版本戳，同结构化数据/参考资料）。
 * @returns `{ updatedAt }`（版本戳）；样本不存在返回 null（路由层映射 404）
 */
export function updatePracticeSampleDraft(db: Db, id: string, draft: string): { updatedAt: string } | null {
  return withTransaction(db, () => {
    if (getPracticeSample(db, id) === null) return null;
    const updatedAt = nowIso();
    queryDb(db)
      .update(practiceSamples)
      .set({ draft, updated_at: updatedAt })
      .where(eq(practiceSamples.id, id))
      .run();
    return { updatedAt };
  });
}

/**
 * 写入仿写点评卡（`submit_style_feedback` 工具的唯一落库入口）——**只写 `feedback`**（JSON 序列化写入），
 * 推进 `updated_at`；范文 `text` 与用户稿 `draft` 一概不动（**AI 能写它自己的产出，不能写用户的产出**）。
 * 卡内形状（字段/引用子串校验）在写入侧 = 提交点评工具，本层只序列化（同 document 先例：库层不校验块体）。
 * @returns `{ updatedAt }`（版本戳）；样本不存在返回 null
 */
export function updatePracticeFeedback(
  db: Db,
  id: string,
  feedback: PracticeFeedback,
): { updatedAt: string } | null {
  return withTransaction(db, () => {
    if (getPracticeSample(db, id) === null) return null;
    const updatedAt = nowIso();
    queryDb(db)
      .update(practiceSamples)
      .set({ feedback: JSON.stringify(feedback), updated_at: updatedAt })
      .where(eq(practiceSamples.id, id))
      .run();
    return { updatedAt };
  });
}

/**
 * 删除样本（`DELETE /practice/samples/:id`）：物理删（练习数据无回收站），行随工作区存续独立。
 * @returns 是否删掉了行（false = 样本不存在，路由层映射 404；重复删除仍返回 false 而不抛错）
 */
export function deletePracticeSample(db: Db, id: string): boolean {
  return queryDb(db).delete(practiceSamples).where(eq(practiceSamples.id, id)).run().changes > 0;
}

// ============ 自由练习（practice_free_pieces） ============

/**
 * 全工作区自由练习列表（`GET /practice/free`）：按 `updated_at` 倒序（同值用 id 升序作稳定次序）、
 * **只出投影列**（`charCount` 走 SQL `length(draft)`，稿件不进内存）；`hasFeedback` 口径同样本列表。
 */
export function listPracticePieces(db: Db): PracticePieceSummary[] {
  const rows = queryDb(db)
    .select({
      id: practiceFreePieces.id,
      topic: practiceFreePieces.topic,
      brief: practiceFreePieces.brief,
      topicSource: practiceFreePieces.topic_source,
      charCount: sql<number>`length(${practiceFreePieces.draft})`,
      hasDraft: sql<number>`(${practiceFreePieces.draft} <> '')`,
      feedback: practiceFreePieces.feedback,
      createdAt: practiceFreePieces.created_at,
      updatedAt: practiceFreePieces.updated_at,
    })
    .from(practiceFreePieces)
    .orderBy(desc(practiceFreePieces.updated_at), asc(practiceFreePieces.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    brief: row.brief,
    topicSource: row.topicSource as PracticeTopicSource,
    charCount: row.charCount,
    hasDraft: row.hasDraft === 1,
    hasFeedback: parseFeedbackColumn(row.feedback) !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 按 id 取自由练习详情（`GET /practice/free/:id`；含稿件与防御解析后的点评卡）；不存在返回 null */
export function getPracticePiece(db: Db, id: string): PracticePieceRow | null {
  const row = queryDb(db).select().from(practiceFreePieces).where(eq(practiceFreePieces.id, id)).get();
  return row === undefined ? null : toPieceRow(row);
}

/**
 * 新建自由练习篇（`POST /practice/free`）：id = `pf-` + nanoid、`draft` = 空串、`feedback` = NULL、
 * created_at = updated_at = 写入时刻。`topic` / `brief` 缺省 = 空串（`topic_source = "ai"` 的空题目行
 * 正是「待出题」状态，题目由出题工具补写）；`topic` 与 `topic_source` 的一致性校验在写入侧 = 路由 schema。
 * @returns 新行（存储形态）
 */
export function createPracticePiece(
  db: Db,
  input: { topicSource: PracticeTopicSource; topic?: string; brief?: string },
): PracticePieceRow {
  const now = nowIso();
  const row: PracticePieceRow = {
    id: generateId("pf-"),
    topic: input.topic ?? "",
    brief: input.brief ?? "",
    topic_source: input.topicSource,
    draft: "",
    feedback: null,
    created_at: now,
    updated_at: now,
  };
  queryDb(db)
    .insert(practiceFreePieces)
    .values({
      id: row.id,
      topic: row.topic,
      brief: row.brief,
      topic_source: row.topic_source,
      draft: row.draft,
      feedback: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    .run();
  return row;
}

/**
 * 保存自由练习稿（`PUT /practice/free/:id`）——自由练习侧**唯一的用户写稿入口**。
 * 口径与仿写稿完全一致（整体覆盖、允许空串、后写覆盖）：`topic` / `brief` / `feedback` 一概不动。
 * @returns `{ updatedAt }`（版本戳）；篇不存在返回 null（路由层映射 404）
 */
export function updatePracticePieceDraft(db: Db, id: string, draft: string): { updatedAt: string } | null {
  return withTransaction(db, () => {
    if (getPracticePiece(db, id) === null) return null;
    const updatedAt = nowIso();
    queryDb(db)
      .update(practiceFreePieces)
      .set({ draft, updated_at: updatedAt })
      .where(eq(practiceFreePieces.id, id))
      .run();
    return { updatedAt };
  });
}

/**
 * 写入题目与写作要求（`submit_practice_topic` 工具的唯一落库入口）——**只写 `topic` / `brief`**，
 * 推进 `updated_at`；用户稿 `draft` 与 `feedback` 一概不动。
 * `brief` 省略 = 不改（工具 schema 里 brief 可选；同 updatePracticeTarget 的部分更新口径）。
 * 「题目非空 → 抛错拒写」的守卫在工具层（写入侧），本层只落库。
 * @returns `{ updatedAt }`（版本戳）；篇不存在返回 null
 */
export function updatePracticePieceTopic(
  db: Db,
  id: string,
  patch: { topic: string; brief?: string },
): { updatedAt: string } | null {
  return withTransaction(db, () => {
    const existing = getPracticePiece(db, id);
    if (existing === null) return null;
    const updatedAt = nowIso();
    queryDb(db)
      .update(practiceFreePieces)
      .set({ topic: patch.topic, brief: patch.brief ?? existing.brief, updated_at: updatedAt })
      .where(eq(practiceFreePieces.id, id))
      .run();
    return { updatedAt };
  });
}

/**
 * 写入自由练习点评卡（`submit_free_feedback` 工具的唯一落库入口）——**只写 `feedback`**，
 * 推进 `updated_at`；`topic` / `brief` / `draft` 一概不动。卡体形状校验同仿写（在写入侧）。
 * @returns `{ updatedAt }`（版本戳）；篇不存在返回 null
 */
export function updatePracticePieceFeedback(
  db: Db,
  id: string,
  feedback: PracticeFeedback,
): { updatedAt: string } | null {
  return withTransaction(db, () => {
    if (getPracticePiece(db, id) === null) return null;
    const updatedAt = nowIso();
    queryDb(db)
      .update(practiceFreePieces)
      .set({ feedback: JSON.stringify(feedback), updated_at: updatedAt })
      .where(eq(practiceFreePieces.id, id))
      .run();
    return { updatedAt };
  });
}

/**
 * 删除自由练习篇（`DELETE /practice/free/:id`）：物理删（不满意的 AI 出题 = 删掉重建，不做覆盖式换题）。
 * @returns 是否删掉了行（false = 篇不存在，路由层映射 404；重复删除仍返回 false 而不抛错）
 */
export function deletePracticePiece(db: Db, id: string): boolean {
  return queryDb(db).delete(practiceFreePieces).where(eq(practiceFreePieces.id, id)).run().changes > 0;
}

// ============ 风格说明素材包（practice_style_packs） ============

/**
 * 取某作家的用户覆盖（`GET /practice/style-pack` 的 `customized` / `updatedAt` 与生效内容来源）。
 * **生效内容 = 覆盖 `??` shared 预置**（回退逻辑在调用侧）。无覆盖返回 null。
 */
export function getStylePack(db: Db, authorId: string): PracticeStylePackRow | null {
  return queryDb(db).select().from(practiceStylePacks).where(eq(practiceStylePacks.author_id, authorId)).get() ?? null;
}

/**
 * 写入用户覆盖（`PUT /practice/style-pack`）：一作家一行，存在即覆盖，`updated_at` 推进。
 * @returns 写入后的行（存储形态）
 */
export function upsertStylePack(db: Db, authorId: string, content: string): PracticeStylePackRow {
  const updatedAt = nowIso();
  queryDb(db)
    .insert(practiceStylePacks)
    .values({ author_id: authorId, content, updated_at: updatedAt })
    .onConflictDoUpdate({
      target: practiceStylePacks.author_id,
      set: { content, updated_at: updatedAt },
    })
    .run();
  return { author_id: authorId, content, updated_at: updatedAt };
}

/**
 * 删除用户覆盖（`DELETE /practice/style-pack`）= **恢复预置**。
 * @returns 是否删掉了行（false = 本来就没有覆盖——幂等口径，路由层照常返回 200 与预置内容）
 */
export function deleteStylePack(db: Db, authorId: string): boolean {
  return queryDb(db).delete(practiceStylePacks).where(eq(practiceStylePacks.author_id, authorId)).run().changes > 0;
}