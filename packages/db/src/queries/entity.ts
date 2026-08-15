// @whispering233/ai-editor-db 实体 CRUD 查询（S3.1）
//
// 单一事实来源：doc/database/schema.md 第 18-39 行（entities 表）、doc/api/endpoints.md 第 150-278 行
// （实体端点：列表 q/分页/排序 + 摘要字段、详情 + deltaCount、创建/部分更新/软删级联）、
// 决策 12（软删：常规查询默认过滤、级联软删关系与 Delta）、决策 14（updated_at 提案快照比对）。
// 时间约定（schema.md 第 16 行）：ISO 8601 应用层写入（nowIso），模块内不生成时间。
//
// 摘要字段提取（endpoints.md 第 184-188 行）：**行内解析**（SELECT 整行 → JSON.parse → JS 提取）——
//   character → role/status、setting → category、location → type、hook → status/payoff_timing、
//   event → description/time_label/tags（决策 26）；
//   取舍：json_extract 免全量 parse 但需按类型动态列，SQL 复杂化；MVP 数据量小，行内解析
//   与 better-sqlite3 字符串列一致（chat.ts 同款风格），数据量大后再优化。
// 级联软删边界：relations/deltas 的**查询**模块 S3.2 才建——本卡只做级联软删所需 UPDATE。

import type { EntityRow, EntitySummary, EntityType } from "@whispering233/ai-editor-shared";
import { ENTITY_TYPES, generateEntityId } from "@whispering233/ai-editor-shared";
import { nowIso } from "../storage/atomic.js";
import { withTransaction, type Db } from "../connection.js";

/** 列表查询参数（endpoints.md 第 162-169 行；缺省值语义与路由层对齐） */
export interface EntityListQuery {
  type?: EntityType;
  /** 搜索关键词（模糊匹配 name；LIKE 通配符 %/_ 原样透传——模糊搜索语义，注释明示） */
  q?: string;
  /**
   * data 字段过滤（S6.3 工具 search_entities 下沉，tools.md「实体查询」filters）：
   * status 精确匹配 data.status；tags 要求 data.tags 数组包含全部指定 tags（AND）。
   * 列表摘要不含 data（toSummary 只提取关键字段），故本过滤走「全行查询 + JS 层判定」。
   */
  filters?: { tags?: string[]; status?: string };
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
    // event（决策 26）：description/time_label/tags 三字段摘要（endpoints.md L269 契约；
    // tags 为数组原样返回——Record 稀疏语义，字段缺失即不出现）
    case "event":
      if (data.description !== undefined) summary.description = data.description;
      if (data.time_label !== undefined) summary.time_label = data.time_label;
      if (data.tags !== undefined) summary.tags = data.tags;
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
 * data 字段过滤（S6.3 工具 search_entities 下沉，filters 语义见 EntityListQuery）：
 * status 字符串相等匹配；tags 要求 data.tags 为数组且包含全部指定 tags（AND）。
 * 匹配失败的字段（如非数组 tags）一律视为不匹配——防御，不做宽松猜测。
 */
function matchDataFilters(data: Record<string, unknown>, filters: { tags?: string[]; status?: string }): boolean {
  if (filters.status !== undefined && data.status !== filters.status) return false;
  if (filters.tags !== undefined && filters.tags.length > 0) {
    const tags = data.tags;
    if (!Array.isArray(tags)) return false;
    for (const tag of filters.tags) {
      if (!tags.includes(tag)) return false;
    }
  }
  return true;
}

/**
 * 实体列表（GET /api/v1/entity/:type，endpoints.md 第 154-193 行）：
 * type 过滤 + q 模糊搜索（name LIKE）+ 排序（name/created_at/updated_at × asc/desc，
 * 白名单防注入）+ 分页（limit clamp 1-200）+ **默认过滤软删**（决策 12）。
 * total 为过滤后总数（不含分页）。
 * filters 语义（S6.3 下沉）：data 字段 JS 过滤（列表摘要不含 data），此时 SQL 只做
 * type/q/软删过滤，filters + 分页在 JS 层（MVP 数据量小，全行查询可接受）；
 * 无 filters 时保持 COUNT + LIMIT SQL 原路径（行为不变）。
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
  // event（时间轴事件，决策 26）固定按 sort_order 升序、NULL 沉底（endpoints.md 契约：
  // 列表恒按 sort_order 升序，sort/order 参数不参与事件排序）——SQLite 中
  // `sort_order IS NULL` 为 1 的排最后，实现 NULL 沉底；id 作稳定次序
  const eventOrderSql = "sort_order IS NULL, sort_order ASC, id ASC";
  const orderSql = query.type === "event" ? eventOrderSql : `${sortCol} ${orderDir}, id ASC`;
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 50)));

  // filters 分支：SQL 取全量候选行（type/q/软删），filters + 分页在 JS 层
  if (query.filters !== undefined) {
    const all = db
      .prepare(`SELECT * FROM entities WHERE ${where.join(" AND ")} ORDER BY ${orderSql}`)
      .all(...params) as Array<Record<string, unknown>>;
    const filtered = all.filter((r) => matchDataFilters(rowToEntityRow(r).data, query.filters!));
    return {
      items: filtered.slice(offset, offset + limit).map((r) => toSummary(rowToEntityRow(r))),
      total: filtered.length,
    };
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM entities WHERE ${where.join(" AND ")}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT * FROM entities WHERE ${where.join(" AND ")}
       ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
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
 * 移动时间轴事件（PUT /api/v1/entity/event/:id/move，决策 26，endpoints.md）：
 * 事件排序为**全局线性序**（跨所有事件，0-based）——
 * 1. 读出全部未软删 event 行按 sort_order 升序（NULL 沉底，id 作稳定次序）排成数组
 * 2. 目标 id 不存在或已软删 → 返回 null（路由层映射 404 ENTITY_NOT_FOUND）
 * 3. 剔除自身后，order clamp 到 [0, 剩余数]（负数→0、超总数→末尾），splice 插入——
 *    与大纲 moveOutlineNode 的数组 splice 语义一致、可验证
 * 4. 重写整个数组的 sort_order 为 0..n-1（事务内逐行 UPDATE），并刷新该行 updated_at
 *
 * 事务：withTransaction 包住读改写（better-sqlite3 同步单连接下无竞态，包事务统一风格，
 * 与 updateEntity/softDeleteEntity 一致）。
 * @returns { moved: true }；事件不存在或已软删返回 null
 */
export function moveEvent(db: Db, id: string, order: number, updatedAt: string): { moved: true } | null {
  return withTransaction(db, () => {
    // 全部未软删 event，按 sort_order 升序（NULL 沉底）排成数组（id 作稳定次序）
    const rows = db
      .prepare(
        `SELECT * FROM entities WHERE type = 'event' AND deleted_at IS NULL
         ORDER BY sort_order IS NULL, sort_order ASC, id ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return null; // 不存在或已软删（决策 12 过滤）
    const [moved] = rows.splice(idx, 1);
    // clamp 到 [0, 剩余数]：负数→0、超总数→末尾（endpoints.md 契约）
    const pos = Math.max(0, Math.min(Math.trunc(order), rows.length));
    rows.splice(pos, 0, moved);
    // 重写全局线性序 0..n-1；被移动行刷新 updated_at（决策 14 版本戳语义），其余行不动
    const update = db.prepare("UPDATE entities SET sort_order = ?, updated_at = ? WHERE id = ?");
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as { id: string; updated_at: string };
      update.run(i, row.id === id ? updatedAt : row.updated_at, row.id);
    }
    return { moved: true };
  });
}

/**
 * 全部未软删时间轴事件（决策 26）：按 sort_order 升序（NULL 沉底，id 作稳定次序）。
 * moveEvent / reorderEvents / 工具层（propose_reorder_events 生成与执行，F9）共用——
 * 事件排序的单一事实来源查询，避免各处手写同款 SQL。
 */
export function listAllEvents(db: Db): EntityRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM entities WHERE type = 'event' AND deleted_at IS NULL
       ORDER BY sort_order IS NULL, sort_order ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => rowToEntityRow(r));
}

/**
 * 批量重排时间轴事件（F9，决策 26 修订注记：LLM 识别 time_label 语义排序 → 提案确认后执行）：
 * 1. 事务内读出当前全部未软删 event id 集合（listAllEvents 同款序）
 * 2. **校验 orderedIds 与当前集合完全相等**（缺/多/重复 → 抛错）——正常由提案 references
 *    快照校验先拦截（决策 14），此处为防御纵深（LLM 幻觉漏事件 / 确认前用户已拖拽增删）
 * 3. 按 orderedIds 序重写全部事件 sort_order 0..n-1
 * 4. **全部事件 updated_at 统一刷新为 nowIso**——批量重排是**全量变化**（每个事件的位置
 *    都是新序的一环），与 moveEvent 只刷被移单行（决策 14 版本戳语义）区分
 *
 * @returns 重排事件数（n）
 */
export function reorderEvents(db: Db, orderedIds: string[], nowIsoTimestamp: string): number {
  return withTransaction(db, () => {
    const rows = listAllEvents(db);
    const currentIds = new Set(rows.map((r) => r.id));
    const orderedSet = new Set(orderedIds);
    // 缺失 = 当前集合有而新序没有（漏事件，LLM 幻觉）；多余 = 新序含当前集合没有的 id（不存在/已软删）
    const missing = rows.map((r) => r.id).filter((id) => !orderedSet.has(id));
    const extra = orderedIds.filter((id) => !currentIds.has(id));
    if (orderedSet.size !== orderedIds.length || missing.length > 0 || extra.length > 0) {
      const dup = orderedSet.size !== orderedIds.length ? "（含重复）" : "";
      const brief = (ids: string[]): string =>
        ids.length === 0 ? "" : `（${ids.slice(0, 5).join(", ")}${ids.length > 5 ? "…" : ""}）`;
      throw new Error(
        `事件集合与当前时间轴不一致${dup}: 缺失 ${missing.length} 个${brief(missing)}、多余 ${extra.length} 个${brief(extra)}`,
      );
    }
    const update = db.prepare("UPDATE entities SET sort_order = ?, updated_at = ? WHERE id = ?");
    for (let i = 0; i < orderedIds.length; i++) {
      update.run(i, nowIsoTimestamp, orderedIds[i]);
    }
    return orderedIds.length;
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

// ============ 聚合统计（S6.3 工具 get_entity_summary 下沉，tools.md「聚合分析」） ============

/** 实体聚合统计结果：总数 + 类型专属分布（稀疏字段，仅出现对应类型的分布） */
export interface EntitySummaryStats {
  type: EntityType;
  /** 非软删实体总数（决策 12 修订：回收站对象不计入） */
  total: number;
  /** character：data.role 分布 */
  byRole?: Record<string, number>;
  /** character / hook：data.status 分布 */
  byStatus?: Record<string, number>;
  /** setting：data.category 分布 */
  byCategory?: Record<string, number>;
  /** location：data.type 分布 */
  byType?: Record<string, number>;
  /** hook：data.payoff_timing 分布 */
  byPayoffTiming?: Record<string, number>;
  /** character：data.abilities 频率（取前 10，防 token 爆炸，决策 15） */
  topAbilities?: { ability: string; count: number }[];
}

/** 字符串值直方图（非字符串/空串不计入——data 字段稀疏，防御） */
function countBy(values: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    if (typeof v === "string" && v !== "") {
      out[v] = (out[v] ?? 0) + 1;
    }
  }
  return out;
}

/** abilities 频率统计（数组元素展平计数，取前 limit 名；按频率降序、同频名称序） */
function topAbilityCounts(rows: Array<Record<string, unknown>>, limit: number): { ability: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const row of rows) {
    const abilities = parseDataColumn(row.data).abilities;
    if (!Array.isArray(abilities)) continue;
    for (const ability of abilities) {
      if (typeof ability === "string" && ability !== "") {
        freq.set(ability, (freq.get(ability) ?? 0) + 1);
      }
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([ability, count]) => ({ ability, count }));
}

/**
 * 实体聚合统计（S6.3 工具 get_entity_summary 下沉，tools.md「聚合分析」）：
 * 指定类型实体的总数 + 类型专属分布。仅统计非软删实体（决策 12 修订）；
 * 分布字段按类型稀疏出现：character→byRole/byStatus/topAbilities、setting→byCategory、
 * location→byType、hook→byStatus/byPayoffTiming；缺字段（data 未填）不报错、不计入。
 */
export function getEntitySummaryStats(db: Db, type: EntityType): EntitySummaryStats {
  const rows = db
    .prepare("SELECT data FROM entities WHERE type = ? AND deleted_at IS NULL")
    .all(type) as Array<Record<string, unknown>>;

  const result: EntitySummaryStats = { type, total: rows.length };
  const dataOf = (r: Record<string, unknown>): Record<string, unknown> => parseDataColumn(r.data);
  switch (type) {
    case "character":
      result.byRole = countBy(rows.map((r) => dataOf(r).role));
      result.byStatus = countBy(rows.map((r) => dataOf(r).status));
      result.topAbilities = topAbilityCounts(rows, 10);
      break;
    case "setting":
      result.byCategory = countBy(rows.map((r) => dataOf(r).category));
      break;
    case "location":
      result.byType = countBy(rows.map((r) => dataOf(r).type));
      break;
    case "hook":
      result.byStatus = countBy(rows.map((r) => dataOf(r).status));
      result.byPayoffTiming = countBy(rows.map((r) => dataOf(r).payoff_timing));
      break;
  }
  return result;
}
