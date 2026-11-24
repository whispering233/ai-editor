// @whispering233/ai-editor-db 章正文历史快照读写（document_snapshots，2026-11）
//
// 语义与不变式见 `docs/db/schema.md`「document_snapshots」、端点见 `docs/api/110-api-manuscript.md`「章级历史」：
// - 快照记**被覆盖的旧内容**：保存钩子把 `document_records` 里的旧 content 压一份；当前内容不进历史
// - **唯一排序键 = `seq`**（自增主键）：同秒多次保存也稳定，不靠 `created_at`
// - 只存 content + char_count（不存 content_text——恢复时由服务端用 shared 派生重算）
// - 节流间隔与两个上限（单章份数 / 全书字数预算）是 shared 常量，本模块是唯一执行点
// - 无软删：裁剪是物理删；章 purge 时随正文行一并物理删（deleteSnapshotsByOwner）
//
// 时间约定：ISO 8601 由调用方传入（`now`），模块内不生成时间。

import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  CHAPTER_SNAPSHOT_MIN_INTERVAL_MS,
  MAX_SNAPSHOTS_PER_DOCUMENT,
  SNAPSHOT_BUDGET_MULTIPLIER,
} from "@whispering233/ai-editor-shared";
import type { Db } from "../connection.js";
import { queryDb } from "../query-db.js";
import { documentRecords, documentSnapshots } from "../tables.js";
import type { DocumentOwnerKind } from "./document.js";

/** document_snapshots 行（列名与 DDL 同形；无 JSON 列，故无防御解析必要） */
export interface DocumentSnapshotRow {
  seq: number;
  owner_kind: DocumentOwnerKind;
  owner_id: string;
  content: string;
  char_count: number;
  created_at: string;
}

/** 列表项（不带 content：历史抽屉只需要体积元信息，正文按需单取；字段与 API 响应同形） */
export interface DocumentSnapshotSummary {
  seq: number;
  createdAt: string;
  charCount: number;
}

/** 压快照入参：content 是**被覆盖的旧内容**，charCount 是它的正文字数 */
export interface InsertSnapshotInput {
  ownerKind: DocumentOwnerKind;
  ownerId: string;
  content: string;
  charCount: number;
  now: string;
 /** true = 绕过节流（恢复前强压当前内容）；去重照旧生效 */
  force?: boolean;
}

/** 行 → DocumentSnapshotRow（列名直映射；表无 JSON 列） */
function rowToSnapshot(row: Record<string, unknown>): DocumentSnapshotRow {
  return {
    seq: row.seq as number,
    owner_kind: row.owner_kind as DocumentOwnerKind,
    owner_id: row.owner_id as string,
    content: row.content as string,
    char_count: row.char_count as number,
    created_at: row.created_at as string,
  };
}

/** 该 owner 的最新一份快照（节流与去重的判定基准；无快照返回 null） */
function latestSnapshot(db: Db, ownerKind: DocumentOwnerKind, ownerId: string): DocumentSnapshotRow | null {
  // SAFETY: 无投影 select() 返回该表全部列，widen 成列名映射的记录类型是等价的
  const row = queryDb(db)
    .select()
    .from(documentSnapshots)
    .where(and(eq(documentSnapshots.owner_kind, ownerKind), eq(documentSnapshots.owner_id, ownerId)))
    .orderBy(desc(documentSnapshots.seq))
    .limit(1)
    .get() as unknown as Record<string, unknown> | undefined;
  return row === undefined ? null : rowToSnapshot(row);
}

/**
 * 到期才压快照（节流 + 去重的**唯一执行点**）：
 * - 去重：最新一份内容与本次待压内容相同 → 跳过（这份旧内容已在历史里）
 * - 节流：距该章最后一份不足 `CHAPTER_SNAPSHOT_MIN_INTERVAL_MS` → 跳过（`force` 绕过）
 *
 * 时间比较用 `Date.parse` 差值；`created_at` 坏值退化为不节流（宁可留下一份，不丢历史）。
 * @returns `inserted` = 是否真的写入了一行
 */
export function insertSnapshotIfDue(db: Db, input: InsertSnapshotInput): { inserted: boolean } {
  const latest = latestSnapshot(db, input.ownerKind, input.ownerId);
  if (latest !== null) {
    if (latest.content === input.content) return { inserted: false };
    const elapsed = Date.parse(input.now) - Date.parse(latest.created_at);
    if (input.force !== true && elapsed < CHAPTER_SNAPSHOT_MIN_INTERVAL_MS) return { inserted: false };
  }
  queryDb(db)
    .insert(documentSnapshots)
    .values({
      owner_kind: input.ownerKind,
      owner_id: input.ownerId,
      content: input.content,
      char_count: input.charCount,
      created_at: input.now,
    })
    .run();
  return { inserted: true };
}

/** 该书正文总量（全局预算的基数）：全部章正文投影字数之和 */
function bookTextChars(db: Db): number {
  const row = queryDb(db)
    .select({ total: sql<number>`COALESCE(SUM(LENGTH(${documentRecords.content_text})), 0)` })
    .from(documentRecords)
    .where(eq(documentRecords.owner_kind, "chapter"))
    .get();
  // 预算口径用 SQL LENGTH（字符数）：与 char_count（JS UTF-16 长度）只在增补平面字符上差 1，预算允许该误差
  return row?.total ?? 0;
}

/**
 * 裁剪（两个上限都从**最旧**删，与 `created_at` 无关——只按 `seq`）：
 * 1. 每章保留最新 `MAX_SNAPSHOTS_PER_DOCUMENT` 份（防单章独占预算）；
 * 2. 全书快照字数 ≤ `SNAPSHOT_BUDGET_MULTIPLIER` × 该书正文总量（从最新往最旧累计，超额的最旧部分删）。
 *
 * 调用时机：仅在本次真的压入一份快照之后（无新快照无需重算）。
 * @returns 实际删除行数
 */
export function trimSnapshots(db: Db, ownerKind: DocumentOwnerKind, ownerId: string): number {
  const keep = queryDb(db)
    .select({ seq: documentSnapshots.seq })
    .from(documentSnapshots)
    .where(and(eq(documentSnapshots.owner_kind, ownerKind), eq(documentSnapshots.owner_id, ownerId)))
    .orderBy(desc(documentSnapshots.seq))
    .limit(MAX_SNAPSHOTS_PER_DOCUMENT)
    .all()
    .map((row) => row.seq);
  const trimmedPerDocument =
    keep.length === 0
      ? 0
      : queryDb(db)
          .delete(documentSnapshots)
          .where(
            and(
              eq(documentSnapshots.owner_kind, ownerKind),
              eq(documentSnapshots.owner_id, ownerId),
              notInArray(documentSnapshots.seq, keep),
            ),
          )
          .run().changes;

 // 从最新往最旧累计字数：累计已超预算的行就是超额的「最旧部分」（整行删，不拆半份）
  const budget = bookTextChars(db) * SNAPSHOT_BUDGET_MULTIPLIER;
  const trimmedGlobal = queryDb(db).run(sql`
    DELETE FROM document_snapshots WHERE seq IN (
      SELECT seq FROM (
        SELECT seq, SUM(char_count) OVER (ORDER BY seq DESC) AS running FROM document_snapshots
      ) WHERE running > ${budget}
    )
  `).changes;
  return trimmedPerDocument + trimmedGlobal;
}

/** 该章的全部快照元信息（`seq` 降序 = 新→旧；列表端点用） */
export function listSnapshots(
  db: Db,
  ownerKind: DocumentOwnerKind,
  ownerId: string,
): DocumentSnapshotSummary[] {
  return queryDb(db)
    .select({
      seq: documentSnapshots.seq,
      createdAt: documentSnapshots.created_at,
      charCount: documentSnapshots.char_count,
    })
    .from(documentSnapshots)
    .where(and(eq(documentSnapshots.owner_kind, ownerKind), eq(documentSnapshots.owner_id, ownerId)))
    .orderBy(desc(documentSnapshots.seq))
    .all();
}

/** 取某一份快照（必须同时命中 owner 与 seq：`seq` 全局自增，跨章不可读） */
export function getSnapshot(
  db: Db,
  ownerKind: DocumentOwnerKind,
  ownerId: string,
  seq: number,
): DocumentSnapshotRow | null {
  // SAFETY: 无投影 select() 返回该表全部列，widen 成列名映射的记录类型是等价的
  const row = queryDb(db)
    .select()
    .from(documentSnapshots)
    .where(
      and(
        eq(documentSnapshots.owner_kind, ownerKind),
        eq(documentSnapshots.owner_id, ownerId),
        eq(documentSnapshots.seq, seq),
      ),
    )
    .get() as unknown as Record<string, unknown> | undefined;
  return row === undefined ? null : rowToSnapshot(row);
}

/**
 * 删某 owner 的全部快照（purge 级联：owner 被物理删时一并清历史，避免孤儿行占预算）。
 * @returns 实际删除行数（无历史返回 0，幂等）
 */
export function deleteSnapshotsByOwner(db: Db, ownerKind: DocumentOwnerKind, ownerId: string): number {
  return queryDb(db)
    .delete(documentSnapshots)
    .where(and(eq(documentSnapshots.owner_kind, ownerKind), eq(documentSnapshots.owner_id, ownerId)))
    .run().changes;
}