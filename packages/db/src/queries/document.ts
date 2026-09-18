// @whispering233/ai-editor-db 块文档读写（章正文 / 参考资料正文，卡 12.2）
//
// 真相 = document_records.content（块数组 JSON 字符串，服务端读路径不解析）；content_text 是
// **服务端派生的纯文本投影**（派生逻辑归调用方——本包不解析块结构，见 AGENTS「服务端不解析块结构」），
// 本模块只负责原样存取。
// **库写入唯一入口 = 本模块**（禁止绕过直接写表）。
// 时间约定：ISO 8601 应用层写入（`now` 由调用方传入，模块内不生成时间）。
// 生命周期：无 deleted_at——owner 软删时调用方不读（端点 404）、purge 时调用方删行，
// 故本模块只提供按 owner 删行的入口（deleteDocumentsByOwner）。

import { and, eq } from "drizzle-orm";
import type { Db } from "../connection.js";
import { queryDb } from "../query-db.js";
import { documentRecords } from "../tables.js";

/** owner 类型：章节点（`ch-*`）/ 参考资料实体（`ref-*`）——枚举值少且稳定，DDL 不加 CHECK */
export type DocumentOwnerKind = "chapter" | "reference";

/** document_records 行（列名与 DDL 同形；无 JSON 列，故无防御解析必要） */
export interface DocumentRow {
  owner_kind: DocumentOwnerKind;
  owner_id: string;
  content: string;
  content_text: string;
  created_at: string;
  updated_at: string;
}

/** upsert 入参：content 为块数组 JSON 字符串、contentText 为服务端已派生好的投影、now 为本次写入时间 */
export interface UpsertDocumentInput {
  ownerKind: DocumentOwnerKind;
  ownerId: string;
  content: string;
  contentText: string;
  now: string;
}

/** 行 → DocumentRow（列名直映射；表无 JSON 列，无需坏行防御） */
function rowToDocumentRow(row: Record<string, unknown>): DocumentRow {
  return {
    owner_kind: row.owner_kind as DocumentOwnerKind,
    owner_id: row.owner_id as string,
    content: row.content as string,
    content_text: row.content_text as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * 取某 owner 的块文档（章正文 / 参考资料正文）。
 * @returns 行对象；从未写过返回 null（端点侧按空文档语义处理）
 */
export function getDocument(db: Db, ownerKind: DocumentOwnerKind, ownerId: string): DocumentRow | null {
  const row = queryDb(db)
    .select()
    .from(documentRecords)
    .where(and(eq(documentRecords.owner_kind, ownerKind), eq(documentRecords.owner_id, ownerId)))
    .get() as unknown as Record<string, unknown> | undefined;
  return row === undefined ? null : rowToDocumentRow(row);
}

/**
 * 写入块文档（首写插入 / 已有则整篇覆盖，按复合主键 `(owner_kind, owner_id)` upsert）。
 *
 * - 单条 `INSERT ... ON CONFLICT DO UPDATE`：无需读后写，天然原子（无并发插入竞态）
 * - `created_at` 只在首次写入时落下，覆盖写不动它（保持「首次创建时间」语义）
 * - `updated_at` = `input.now`，每次写入推进（版本戳，供 `base_updated_at` 比对拦覆盖）
 * - `content_text` 由调用方派生后传入——**派生失败也要保存**（调用方可退化为空串/尽力抽取）
 *
 * @returns 写入后的版本戳（= input.now）
 */
export function upsertDocument(db: Db, input: UpsertDocumentInput): { updatedAt: string } {
  queryDb(db)
    .insert(documentRecords)
    .values({
      owner_kind: input.ownerKind,
      owner_id: input.ownerId,
      content: input.content,
      content_text: input.contentText,
      created_at: input.now,
      updated_at: input.now,
    })
    .onConflictDoUpdate({
      target: [documentRecords.owner_kind, documentRecords.owner_id],
      set: { content: input.content, content_text: input.contentText, updated_at: input.now },
    })
    .run();
  return { updatedAt: input.now };
}

/**
 * 删某 owner 的块文档行（purge 级联：owner 被物理删时一并清行）。
 * @returns 实际删除行数（一 owner 至多 1 行；无行返回 0，幂等）
 */
export function deleteDocumentsByOwner(db: Db, ownerKind: DocumentOwnerKind, ownerId: string): number {
  return queryDb(db)
    .delete(documentRecords)
    .where(and(eq(documentRecords.owner_kind, ownerKind), eq(documentRecords.owner_id, ownerId)))
    .run().changes;
}
