// @ai-editor/db 实体 CRUD 查询（S3.1）
//
// 单一事实来源：doc/database/schema.md 第 18-39 行（entities 表）、doc/api/endpoints.md 第 150-278 行
// （实体端点：列表 q/分页/排序 + 摘要字段、详情 + deltaCount、创建/部分更新/软删级联）、
// 决策 12（软删：常规查询默认过滤、级联软删关系与 Delta）、决策 14（updated_at 提案快照比对）。
// 时间约定（schema.md 第 16 行）：ISO 8601 应用层写入（nowIso），模块内不生成时间。
//
// 摘要字段提取（endpoints.md 第 184-188 行）：**行内解析**（SELECT 整行 → JSON.parse → JS 提取）——
//   character → role/status、setting → category、location → type、hook → status/payoff_timing；
//   取舍：json_extract 免全量 parse 但需按类型动态列，SQL 复杂化；MVP 数据量小，行内解析
//   与 better-sqlite3 字符串列一致（chat.ts 同款风格），数据量大后再优化。
// 级联软删边界：relations/deltas 的**查询**模块 S3.2 才建——本卡只做级联软删所需 UPDATE。

import type { EntityRow, EntitySummary, EntityType } from "@ai-editor/shared";
import { ENTITY_TYPES, generateEntityId } from "@ai-editor/shared";
import { nowIso } from "../storage/atomic.js";
import { withTransaction, type Db } from "../connection.js";

/** 列表查询参数（endpoints.md 第 162-169 行；缺省值语义与路由层对齐） */
export interface EntityListQuery {
  type?: EntityType;
  /** 搜索关键词（模糊匹配 name；LIKE 通配符 %/_ 原样透传——模糊搜索语义，注释明示） */
  q?: string;
  /** 分页偏移，默认 0 */
  offset?: number;
  /** 每页条数，默认 50，最大 200（超限 clamp，防恶意大页） */
  limit?: number;
  sort?: "name" | "created_at" | "updated_at";
  order?: "asc" | "desc";
}

/** 列表结果（endpoints.md 第 171-177 行；items 为 API 形态 EntitySummary，与 chat.ts 同款风格） */
export interface EntityListResult {
  items: EntitySummary[];
  total: number;
}

/** 行 → 摘要：data 已解析，按类型提取关键字段（字段缺失即不出现——Record 稀疏语义） */
function toSummary(row: EntityRow): EntitySummary {
  const data = row.data as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  switch (row.type) {
    case "character":
      if (data.role !== undefined) summary.role = data.role;
      if (data.status !== undefined) summary.status = data.status;
      break;
    case "setting":
      if (data.category !== undefined) summary.category = data.category;
      break;
    case "location":
      if (data.type !== undefined) summary.type = data.type;
      break;
    case "hook":
      if (data.status !== undefined) summary.status = data.status;
      if (data.payoff_timing !== undefined) summary.payoff_timing = data.payoff_timing;
      break;
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 行 → EntityRow（data 从 JSON 字符串解析为对象；坏行防御见 rowToEntityRow 注释） */
export function rowToEntityRow(row: Record<string, unknown>): EntityRow {
  return {
    id: row.id as string,
    type: row.type as EntityType,
    name: row.name as string,
    data: parseDataColumn(row.data),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/**
 * 解析 data 列（oracle 审核建议 1：JSON.parse 防御）：
 * 非法 JSON（手改库/异常写入）时返回 {} 而非抛错——否则 listEntities 整表查询
 * 会被单条坏行打挂；与 chat.ts 的 parseToolCalls 防御风格一致。坏行以空 data 呈现，
 * 其余行正常返回；修复入口为回收站清理/手动修正（不在本层静默写回）。
 */
function parseDataColumn(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * 实体列表（GET /api/v1/entity/:type，endpoints.md 第 154-193 行）：
 * type 过滤 + q 模糊搜索（name LIKE）+ 排序（name/created_at/updated_at × asc/desc，
 * 白名单防注入）+ 分页（limit clamp 1-200）+ **默认过滤软删**（决策 12）。
 * total 为过滤后总数（不含分页）。
 */
export function listEntities(db: Db, query: EntityListQuery): EntityListResult {
  const where = ["deleted_at IS NULL"];
  const params: unknown[] = [];
  if (query.type !== undefined) {
    where.push("type = ?");
    params.push(query.type);
  }
  if (query.q !== undefined && query.q !== "") {
    where.push("name LIKE ?");
    params.push(`%${query.q}%`);
  }
  // 排序白名单（列名不可参数化，只允许枚举值；id 作次级排序保证稳定分页）
  const sortCol = query.sort === "name" ? "name" : query.sort === "created_at" ? "created_at" : "updated_at";
  const orderDir = query.order === "asc" ? "ASC" : "DESC";
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 50)));

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM entities WHERE ${where.join(" AND ")}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT * FROM entities WHERE ${where.join(" AND ")}
       ORDER BY ${sortCol} ${orderDir}, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return { items: rows.map((r) => toSummary(rowToEntityRow(r))), total };
}

/** 按 id 取实体详情（GET /api/v1/entity/:type/:id）；不存在或已软删返回 null（决策 12 过滤） */
export function getEntity(db: Db, id: string): EntityRow | null {
  const row = db
    .prepare("SELECT * FROM entities WHERE id = ? AND deleted_at IS NULL")
    .get(id) as Record<string, unknown> | undefined;
  return row === undefined ? null : rowToEntityRow(row);
}

/** 实体的 Delta 计数（详情响应 deltaCount；决策 12 修订：目标实体软删的 Delta 不可见） */
export function countDeltasForEntity(db: Db, id: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM delta_records WHERE target_id = ? AND deleted_at IS NULL")
      .get(id) as { c: number }
  ).c;
}

/**
 * 创建实体（POST /api/v1/entity/:type，endpoints.md 第 221-253 行）：
 * id = shared generateEntityId（char-/set-/loc-/hook- 前缀）、created_at/updated_at 应用层 ISO、
 * data 缺省 {}、type 必须 ∈ ENTITY_TYPES（非法抛错——路由层 schema 校验后一般不可达，防御）。
 * @returns 新行（EntityRow，data 已解析）
 */
export function createEntity(
  db: Db,
  input: { type: EntityType; name: string; data?: Record<string, unknown> },
): EntityRow {
  if (!(ENTITY_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`createEntity: 非法实体类型 ${input.type}`);
  }
  const now = nowIso();
  const row: EntityRow = {
    id: generateEntityId(input.type),
    type: input.type,
    name: input.name,
    data: input.data ?? {},
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  db.prepare("INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    row.id,
    row.type,
    row.name,
    JSON.stringify(row.data),
    row.created_at,
    row.updated_at,
  );
  return row;
}

/**
 * 部分更新实体（PUT /api/v1/entity/:type/:id，endpoints.md 第 255-278 行）：
 * 仅合并传入字段——name 直接替换；data **浅合并**（未传字段保留，endpoints.md 第 267 行）；
 * updated_at 刷新（决策 14 提案快照比对）。软删实体不可更新（getEntity 过滤 → null，路由层 404）。
 * 读后写包 withTransaction（oracle 审核建议 2）：better-sqlite3 同步单连接下无竞态（安全），
 * 包事务统一风格（与 softDeleteEntity 一致）；返回行在事务内直接构造，无额外复杂度。
 * @returns 更新后的行；实体不存在或已软删返回 null
 */
export function updateEntity(
  db: Db,
  id: string,
  patch: { name?: string; data?: Record<string, unknown> },
): EntityRow | null {
  return withTransaction(db, () => {
    const existing = getEntity(db, id);
    if (existing === null) return null;
    const next: EntityRow = {
      ...existing,
      name: patch.name ?? existing.name,
      data: patch.data === undefined ? existing.data : { ...existing.data, ...patch.data },
      updated_at: nowIso(),
    };
    db.prepare("UPDATE entities SET name = ?, data = ?, updated_at = ? WHERE id = ?").run(
      next.name,
      JSON.stringify(next.data),
      next.updated_at,
      id,
    );
    return next;
  });
}

/**
 * 软删实体（DELETE /api/v1/entity/:type/:id，决策 12）：
 * **级联软删关联关系与 Delta**（单库内事务保证原子性）：
 * - relation_records：source_id = id **或** target_id = id（任一端点软删即不可见，决策 12 修订）
 * - delta_records：target_id = id（目标实体软删即不可见，决策 12 修订）
 * - 自身：deleted_at 置位 + updated_at 刷新（决策 12 修订：软删亦更新版本戳）
 * 幂等：实体已软删（或不存在）→ 返回 null 且无任何副作用（级联 UPDATE 均带 deleted_at IS NULL 过滤）。
 *
 * @returns { relations, deltas } 实际级联行数；实体不存在/已软删返回 null
 */
export function softDeleteEntity(db: Db, id: string, deletedAt: string): { relations: number; deltas: number } | null {
  return withTransaction(db, () => {
    const exists = db.prepare("SELECT id FROM entities WHERE id = ? AND deleted_at IS NULL").get(id);
    if (exists === undefined) return null;
    const rel = db
      .prepare(
        `UPDATE relation_records SET deleted_at = ? WHERE deleted_at IS NULL AND (source_id = ? OR target_id = ?)`,
      )
      .run(deletedAt, id, id);
    const delta = db
      .prepare(`UPDATE delta_records SET deleted_at = ? WHERE deleted_at IS NULL AND target_id = ?`)
      .run(deletedAt, id);
    db.prepare("UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(
      deletedAt,
      deletedAt,
      id,
    );
    return { relations: rel.changes, deltas: delta.changes };
  });
}
