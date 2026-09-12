// @whispering233/ai-editor-db 实体 CRUD 查询（S3.1）
//
// （实体端点：列表 q/分页/排序 + 摘要字段、详情 + deltaCount、创建/部分更新/软删级联）、
// （软删：常规查询默认过滤、级联软删关系与 Delta）、（updated_at 提案快照比对）。
// 时间约定：ISO 8601 应用层写入（nowIso），模块内不生成时间。
//
// 摘要字段提取：**行内解析**（SELECT 整行 → JSON.parse → JS 提取）——
// character → role/description/motivation/personality/ability_panel（2026-09：面板顶层分组名前 2）、
// setting → tags/description（M2）、location → type、hook → status/payoff_timing、
// event → description/tags；
// 取舍：json_extract 免全量 parse 但需按类型动态列，SQL 复杂化；MVP 数据量小，行内解析
// 与 better-sqlite3 字符串列一致（chat.ts 同款风格），数据量大后再优化。
// 级联软删边界：relations/deltas 的**查询**模块 S3.2 才建——本卡只做级联软删所需 UPDATE。
//
// 查询全部经 queryDb 走 drizzle 构建器（混合风格 4A）。
// 语义逐句对照改造（git show 52c7c13^:packages/db/src/queries/entity.ts）：
// - deleted_at IS NULL ↔ isNull；软删过滤语义不变
// - name LIKE ? ↔ like(entities.name, `%${q}%`)——通配符 %/_ 原样透传（模糊搜索语义）
// - 排序白名单（name/created_at/updated_at × asc/desc）↔ 动态选列对象 desc/asc（无字符串拼接）
// - event/timepoint 固定排序 `sort_order IS NULL, sort_order ASC, id ASC` ↔ orderBy(sql 模板)（NULL 沉底）
// - COUNT(*) ↔ count；IN 占位符 ↔ inArray（空集生成恒假 SQL，原生 IN (NULL) 语义等价）
// - EXISTS 子查询（eventOccursAt）↔ sql 模板（跨表互引，builder 难表达，4A 允许）
// - 热循环（moveEvent/moveTimepoint/moveSetting/reorderTimepoints 批量重写 sort_order）：
// builder 版循环内每次 .run 重新编译 SQL（prepare 不复用）；数据量小可接受，
// 如需极致性能可改 sql 模板（混合风格边界）——循环处注释明示
// - data 等 JSON 列保持 text 模式：drizzle 行读出 string，写入 JSON.stringify，
// parseDataColumn 防御解析不动（坏行返回 {}，.2 验证）
// 事务沿用 withTransaction（native db.transaction），连接级共享已验证（15.2 验证记录①）。

import type { EntityRow, EntitySummary, EntityType, RelationRow } from "@whispering233/ai-editor-shared";
import { ENTITY_TYPES, generateEntityId, panelTopLevelNames } from "@whispering233/ai-editor-shared";
import { and, asc, count, desc, eq, inArray, isNull, like, or, sql, type SQLWrapper } from "drizzle-orm";
import { nowIso } from "../storage/atomic.js";
import { withTransaction, type Db } from "../connection.js";
import { deltaRecords, entities, relationRecords } from "../tables.js";
import { queryDb } from "../query-db.js";
// relation.ts ↔ entity.ts 循环引用（relation.ts import getEntity）：仅函数调用期使用
// RelationError/rowToRelationRow，无模块顶层求值依赖，ESM 运行时安全。
import {
  createRelation,
  deleteRelation,
  listSettingHierarchyEdges,
  RelationError,
  rowToRelationRow,
  wouldCreateSettingCycle,
} from "./relation.js";

/** 列表查询参数（缺省值语义与路由层对齐） */
export interface EntityListQuery {
  type?: EntityType;
 /** 搜索关键词（模糊匹配 name；LIKE 通配符 %/_ 原样透传——模糊搜索语义，注释明示） */
  q?: string;
 /**
 * data 字段过滤（S6.3 工具 search_entities 下沉，「实体查询」filters）：
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
 /**
 * 上级设定筛选（2026-08，仅 setting）：匹配 = 实体在设定层级树（belongs_to）中
 * 直接或间接属于该上级（**递归子树，不含上级自身**）。复用既有 listSettingHierarchyEdges 全量边建
 * childOf 邻接表 DFS 收集后代 id 集合后走 JS 过滤路径（见 listEntities 注释，total 为过滤后总数）。
 * 指向不存在的设定（含已软删）→ 后代集合为空 → 空结果（宽松，同 tag 无匹配不 404）。
 */
  parentId?: string;
}

/** 列表结果（items 为 API 形态 EntitySummary，与 chat.ts 同款风格） */
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
 // 2026-09（卡片 2.1）：description 摘要（截断 100，同 setting 口径）；status 已移除。
 // 两行式行布局字段：动机摘要截断 40 字符（防 search_entities 工具上下文膨胀）
 // + 性格前 2 个 + 能力 = **面板顶层分组名**前 2 个（如「火系」「水系」——
 // 叶子名多是「等级/熟练度」这类重复词，按叶子计数无意义）
      if (typeof data.description === "string" && data.description !== "") {
        summary.description = data.description.slice(0, 100);
      }
      if (typeof data.motivation === "string" && data.motivation !== "") {
        summary.motivation = data.motivation.slice(0, 40);
      }
      if (Array.isArray(data.personality)) {
        summary.personality = (data.personality as unknown[])
          .filter((t): t is string => typeof t === "string" && t !== "")
          .slice(0, 2);
      }
 // 读端口径：面板结构宽校验（可能脏）→ 必过 parse（panelTopLevelNames 内部自动规范化）
      const panelGroups = panelTopLevelNames(data.ability_panel);
      if (panelGroups.length > 0) summary.ability_panel = panelGroups.slice(0, 2);
      break;
    case "setting":
 // K2（2026-08）：分类由 data.tags 承接（与 event 同字段语义）——摘要暴露 tags（前 3 个）
      if (Array.isArray(data.tags)) {
        summary.tags = (data.tags as unknown[]).filter((t): t is string => typeof t === "string" && t !== "").slice(0, 3);
      }
 // M2（2026-08）：描述摘要截断 100 字符——列表行展示用；截断防 search_entities
 // 工具上下文膨胀（limit 200 × 长文描述会打爆 token 预算），完整文本在详情页
      if (typeof data.description === "string" && data.description !== "") {
        summary.description = data.description.slice(0, 100);
      }
      break;
    case "location":
      if (data.type !== undefined) summary.type = data.type;
      break;
    case "hook":
      if (data.status !== undefined) summary.status = data.status;
      if (data.payoff_timing !== undefined) summary.payoff_timing = data.payoff_timing;
      break;
 // event：description/tags 两字段摘要（
 // tags 为数组原样返回——Record 稀疏语义，字段缺失即不出现）
    case "event":
      if (data.description !== undefined) summary.description = data.description;
      if (data.tags !== undefined) summary.tags = data.tags;
      break;
 // reference（参考资料 + type 分类 + content 摘要截断 120 字 + tags 前 3
 // + 来源字段（11.1 补 source；11.4 起按 kind 区分：file → file_name、link → url、
 // 存量无 kind 条目 → source 兼容）——全文长文本不随列表返回（防列表响应与
 // search_entities 工具上下文膨胀），完整 content 在详情页（get_entity 全量 data）
    case "reference":
      if (data.type !== undefined) summary.type = data.type;
      if (data.kind === "file") {
        if (typeof data.file_name === "string" && data.file_name !== "") summary.file_name = data.file_name;
      } else {
        if (typeof data.url === "string" && data.url !== "") summary.url = data.url;
        else if (typeof data.source === "string" && data.source !== "") summary.source = data.source; // 存量兼容
      }
      if (typeof data.content === "string" && data.content !== "") {
        summary.content = data.content.slice(0, 120);
      }
      if (Array.isArray(data.tags)) {
        summary.tags = (data.tags as unknown[]).filter((t): t is string => typeof t === "string" && t !== "").slice(0, 3);
      }
      break;
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    summary,
 // （2026-08）：仅 setting 暴露同级手动排序位（稀疏——NULL 不出现）
    ...(row.type === "setting" && row.sort_order !== null ? { sortOrder: row.sort_order } : {}),
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
 // setting 复用 sort_order 列承载同级手动排序位（NULL = 未参与）；event/timepoint 为全局线性序
    sort_order: (row.sort_order as number | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/**
 * 解析 data 列（oracle 审核建议 1：JSON.parse 防御）：
 * 非法 JSON（手改库/异常写入）时返回 {} 而非抛错——否则 listEntities 整表查询
 * 会被单条坏行打挂；与 sessions.ts 的 JSON 列防御风格一致。坏行以空 data 呈现，
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
 * status 字符串相等匹配；tags 要求 `data.tags` 为数组且包含全部指定 tags（AND）。
 * **分类字段统一为 data.tags（K2 修订）**：setting 与 event 同语义，不再按类型路由。
 * 匹配失败（如非数组）一律视为不匹配——防御，不做宽松猜测。
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
 * 收集设定层级树中某节点的全部后代 id（2026-08）：复用 listSettingHierarchyEdges 全量边
 * （只读、O(N)、走关系表索引，两端未软删）构建 childOf 邻接表（parentId → 直接子 id 列表），
 * DFS 收集**不含自身**的递归后代集合。防环守卫：结果 Set 去重——已收集节点不再入栈，
 * 数据异常成环也不死循环。父不存在/已软删 → 空集合（边集合已做软删可见性过滤）。
 */
function collectSettingDescendants(db: Db, rootId: string): Set<string> {
  const childOf = new Map<string, string[]>();
  for (const e of listSettingHierarchyEdges(db)) {
    const kids = childOf.get(e.parentId) ?? [];
    kids.push(e.childId);
    childOf.set(e.parentId, kids);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const kid of childOf.get(id) ?? []) {
      if (result.has(kid)) continue;
      result.add(kid);
      stack.push(kid);
    }
  }
  return result;
}

/**
 * 实体列表（GET /api/v1/entity/:type）：
 * type 过滤 + q 模糊搜索（name LIKE）+ 排序（name/created_at/updated_at × asc/desc，
 * 白名单防注入）+ 分页（limit clamp 1-200）+ **默认过滤软删**。
 * total 为过滤后总数（不含分页）。
 * filters 语义（S6.3 下沉）：data 字段 JS 过滤（列表摘要不含 data），此时 SQL 只做
 * type/q/软删过滤，filters + 分页在 JS 层（MVP 数据量小，全行查询可接受）；
 * parentId 语义（上层筛选）：同上——复用 listSettingHierarchyEdges 收集递归后代集合，
 * 与 filters 同款 JS 过滤路径（两者可同时存在，AND 组合；SQL 路径保持 COUNT+LIMIT 行为不变）。
 *
 * drizzle 改造：where 动态条件 and 组合（顺序与旧 where.join 一致：
 * 软删过滤恒为首条）；排序白名单映射为**列对象**（asc/desc 包装，禁止字符串拼接；
 * event/timepoint 固定 sql 模板排序 NULL 沉底）。
 */
export function listEntities(db: Db, query: EntityListQuery): EntityListResult {
  const q = queryDb(db);
  const conds: SQLWrapper[] = [isNull(entities.deleted_at)];
  if (query.type !== undefined) {
    conds.push(eq(entities.type, query.type));
  }
  if (query.q !== undefined && query.q !== "") {
 // LIKE 通配符 %/_ 原样透传——模糊搜索语义（注释明示，不转义）
    conds.push(like(entities.name, `%${query.q}%`));
  }
  const whereExpr = and(...conds);
 // 排序白名单（列名不可参数化，只允许枚举值；id 作次级排序保证稳定分页）
  const sortCol =
    query.sort === "name" ? entities.name : query.sort === "created_at" ? entities.created_at : entities.updated_at;
 // 默认降序（query.order === "asc" 才升序，与旧 `"ASC" : "DESC"` 语义一致）
  const orderAsc = query.order === "asc";
 // event / timepoint（时间轴，G2）固定按 sort_order 升序、NULL 沉底（
 // 列表恒按 sort_order 升序，sort/order 参数不参与排序）——`sort_order IS NULL` 为 1 的排最后
 //（SQLite 布尔序），实现 NULL 沉底；id 作稳定次序
  const orderByExpr =
    query.type === "event" || query.type === "timepoint"
      ? [sql`${entities.sort_order} IS NULL`, asc(entities.sort_order), asc(entities.id)]
      : [orderAsc ? asc(sortCol) : desc(sortCol), asc(entities.id)];
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 50)));

 // JS 过滤路径：filters（S6.3 工具下沉）或 parentId（上级设定筛选）存在时，
 // SQL 取全量候选行（type/q/软删），JS 层执行 data/层级过滤 + 分页（MVP 数据量小，全行查询可接受）；
 // 两者皆无时保持 COUNT + LIMIT SQL 原路径（行为不变）。
  if (query.filters !== undefined || query.parentId !== undefined) {
    const all = q.select().from(entities).where(whereExpr).orderBy(...orderByExpr).all() as unknown as Array<
      Record<string, unknown>
    >;
    const descendants = query.parentId !== undefined ? collectSettingDescendants(db, query.parentId) : null;
    const filtered = all.filter((r) => {
      const row = rowToEntityRow(r);
      if (query.filters !== undefined && !matchDataFilters(row.data, query.filters)) return false;
      if (descendants !== null && !descendants.has(row.id)) return false;
      return true;
    });
    return {
      items: filtered.slice(offset, offset + limit).map((r) => toSummary(rowToEntityRow(r))),
      total: filtered.length,
    };
  }

  const total = (q.select({ c: count() }).from(entities).where(whereExpr).get() as { c: number }).c;
  const rows = q
    .select()
    .from(entities)
    .where(whereExpr)
    .orderBy(...orderByExpr)
    .limit(limit)
    .offset(offset)
    .all() as unknown as Array<Record<string, unknown>>;

  return { items: rows.map((r) => toSummary(rowToEntityRow(r))), total };
}

/** 按 id 取实体详情（GET /api/v1/entity/:type/:id）；不存在或已软删返回 null */
export function getEntity(db: Db, id: string): EntityRow | null {
  const row = queryDb(db)
    .select()
    .from(entities)
    .where(and(eq(entities.id, id), isNull(entities.deleted_at)))
    .get() as unknown as Record<string, unknown> | undefined;
  return row === undefined ? null : rowToEntityRow(row);
}

/** 实体的 Delta 计数（详情响应 deltaCount；目标实体软删的 Delta 不可见） */
export function countDeltasForEntity(db: Db, id: string): number {
  return (
    queryDb(db)
      .select({ c: count() })
      .from(deltaRecords)
      .where(and(eq(deltaRecords.target_id, id), isNull(deltaRecords.deleted_at)))
      .get() as { c: number }
  ).c;
}

/**
 * 创建实体（POST /api/v1/entity/:type）：
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
 // 新实体默认不参与手动排序（setting 首次手动移动时按组重写）
    sort_order: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  queryDb(db)
    .insert(entities)
    .values({
      id: row.id,
      type: row.type,
      name: row.name,
      data: JSON.stringify(row.data), // JSON 列 text 模式
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    .run();
  return row;
}

/**
 * 部分更新实体（PUT /api/v1/entity/:type/:id）：
 * 仅合并传入字段——name 直接替换；data **浅合并**（未传字段保留）；
 * updated_at 刷新（提案快照比对）。软删实体不可更新（getEntity 过滤 → null，路由层 404）。
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
    queryDb(db)
      .update(entities)
      .set({
        name: next.name,
        data: JSON.stringify(next.data), // JSON 列 text 模式
        updated_at: next.updated_at,
      })
      .where(eq(entities.id, id))
      .run();
    return next;
  });
}

/**
 * 移动时间轴事件（PUT /api/v1/entity/event/:id/move）：
 * 事件排序为**全局线性序**（跨所有事件，0-based）——
 * 1. 读出全部未软删 event 行按 sort_order 升序（NULL 沉底，id 作稳定次序）排成数组
 * 2. 目标 id 不存在或已软删 → 返回 null（路由层映射 404 ENTITY_NOT_FOUND）
 * 3. 剔除自身后，order clamp 到 [0, 剩余数]（负数→0、超总数→末尾），splice 插入——
 * 与大纲 moveOutlineNode 的数组 splice 语义一致、可验证
 * 4. 重写整个数组的 sort_order 为 0..n-1（事务内逐行 UPDATE），并刷新该行 updated_at
 *
 * 事务：withTransaction 包住读改写（better-sqlite3 同步单连接下无竞态，包事务统一风格，
 * 与 updateEntity/softDeleteEntity 一致）。
 * @returns { moved: true }；事件不存在或已软删返回 null
 */
export function moveEvent(db: Db, id: string, order: number, updatedAt: string): { moved: true } | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
 // 全部未软删 event，按 sort_order 升序（NULL 沉底）排成数组（id 作稳定次序）
    const rows = q
      .select()
      .from(entities)
      .where(and(eq(entities.type, "event"), isNull(entities.deleted_at)))
      .orderBy(sql`${entities.sort_order} IS NULL`, asc(entities.sort_order), asc(entities.id))
      .all() as unknown as Array<Record<string, unknown>>;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return null; // 不存在或已软删
    const [moved] = rows.splice(idx, 1);
 // clamp 到 [0, 剩余数]：负数→0、超总数→末尾
    const pos = Math.max(0, Math.min(Math.trunc(order), rows.length));
    rows.splice(pos, 0, moved);
 // 重写全局线性序 0..n-1；被移动行刷新 updated_at，其余行不动
 // 热循环：builder 每次 .run 重新编译 SQL（prepare 不复用）；数据量小可接受，
 // 如需极致性能可改 sql 模板（混合风格边界）
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as { id: string; updated_at: string };
      q.update(entities)
        .set({ sort_order: i, updated_at: row.id === id ? updatedAt : row.updated_at })
        .where(eq(entities.id, row.id))
        .run();
    }
    return { moved: true };
  });
}

// ============ 时间标签点（G2）：listTimepoints / moveTimepoint / occurs_at 挂载 ============

/**
 * 全部未软删时间标签点（G2）：按 sort_order 升序（NULL 沉底，id 作稳定次序）——
 * timepoint 的全局线性序（组间序），与 listEntities 的 event 查询同款语义。
 * G2.2/2.3（时间轴渲染、AI 排序 propose_reorder_timepoints）共用，单一事实来源查询。
 */
export function listTimepoints(db: Db): EntityRow[] {
  const rows = queryDb(db)
    .select()
    .from(entities)
    .where(and(eq(entities.type, "timepoint"), isNull(entities.deleted_at)))
    .orderBy(sql`${entities.sort_order} IS NULL`, asc(entities.sort_order), asc(entities.id))
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => rowToEntityRow(r));
}

/**
 * 移动时间标签点（PUT /api/v1/entity/timepoint/:id/move，G2）：
 * 语义与 moveEvent 完全一致（timepoint 全局线性序 0..n-1）——
 * 1. 读出全部未软删 timepoint 按 sort_order 升序（NULL 沉底，id 稳定次序）排成数组
 * 2. 目标 id 不存在或已软删 → 返回 null（路由层映射 404）
 * 3. 剔除自身后 order clamp 到 [0, 剩余数]，splice 插入
 * 4. 重写整个数组 sort_order 为 0..n-1，仅被移动行刷新 updated_at
 *
 * 注意：拖拽 timepoint **不改其下事件序**（双独立线性序，G2 修订）——
 * 本函数只碰 timepoint 行，event.sort_order 与 occurs_at 关系均不动。
 * 事务：withTransaction 包住读改写（同 moveEvent，better-sqlite3 同步单连接无竞态）。
 * @returns { moved: true }；timepoint 不存在或已软删返回 null
 */
export function moveTimepoint(db: Db, id: string, order: number, updatedAt: string): { moved: true } | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const rows = q
      .select()
      .from(entities)
      .where(and(eq(entities.type, "timepoint"), isNull(entities.deleted_at)))
      .orderBy(sql`${entities.sort_order} IS NULL`, asc(entities.sort_order), asc(entities.id))
      .all() as unknown as Array<Record<string, unknown>>;
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return null; // 不存在或已软删
    const [moved] = rows.splice(idx, 1);
    const pos = Math.max(0, Math.min(Math.trunc(order), rows.length));
    rows.splice(pos, 0, moved);
 // 热循环：同 moveEvent（混合风格边界注释）
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as { id: string; updated_at: string };
      q.update(entities)
        .set({ sort_order: i, updated_at: row.id === id ? updatedAt : row.updated_at })
        .where(eq(entities.id, row.id))
        .run();
    }
    return { moved: true };
  });
}

// ============ 设定手动排序（2026-08）：同级组内线性序 ============

/**
 * 移动设定（PUT /api/v1/entity/setting/:id/move；修订「设定无 sort_order 语义」）：
 * **复合写**——改父 + 同级重排一次事务提交（对齐 G2 event move_to 先例）：
 * 1. 存在性：目标设定不存在/已软删 → null（路由层映射 404）
 * 2. 防环（与 POST /relation 同级校验）：目标父 = 自身 → 自指；
 * 目标父的祖先链含该设定 → 成环——均抛 RelationError SETTING_CYCLE（路由层映射 400）
 * 3. 改父（targetParentId ≠ 当前父）→ 事务内先建新 belongs_to 边（createRelation 校验
 * 父端点存在性 → ENDPOINT_NOT_FOUND）后物理删旧边（先建后删防数据丢失，对齐 EntityDetail）
 * 4. 同级重排：目标组 = 新父的子级组 / 根 = 无父设定组（改父后按新边计算）；
 * 组内按（sort_order NULL 沉底 → sort_order → name → id）排齐，剔除自身后按 order
 * （0-based，缺省 = 组尾）splice 插入，重写组内 sort_order 0..n-1——
 * 仅被移行刷新 updated_at，其余行时间戳不动
 * @returns { moved: true }；设定不存在/已软删返回 null
 * @throws RelationError SETTING_CYCLE（自指/成环）/ ENDPOINT_NOT_FOUND（目标父不存在/已软删）
 */
export function moveSetting(
  db: Db,
  id: string,
  input: { parentId: string | null; order?: number },
  outlineDir: string,
): { moved: true } | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const row = getEntity(db, id);
    if (row === null) return null; // 不存在或已软删
    const edges = listSettingHierarchyEdges(db);
    const parentOf = new Map(edges.map((e) => [e.childId, e.parentId]));
    const currentParent = parentOf.get(id) ?? null;
    const targetParent = input.parentId;
 // 防环/自指：先于任何写操作校验——目标父的祖先链不得含该设定
    if (targetParent !== null) {
      if (targetParent === id) {
        throw new RelationError("SETTING_CYCLE", "设定不能作为自己的上级");
      }
      if (wouldCreateSettingCycle(db, id, targetParent)) {
        throw new RelationError("SETTING_CYCLE", "设定层级不能成环（上级的祖先链包含该设定）");
      }
 // 父端点存在性（createRelation 也会校验——此处提前给出明确错误定位）
      if (getEntity(db, targetParent) === null) {
        throw new RelationError("ENDPOINT_NOT_FOUND", `上级设定不存在或已软删: ${targetParent}`);
      }
    }
 // 改父：先建新边后删旧边（同父含同为根 → 跳过）
    if (targetParent !== currentParent) {
      if (targetParent !== null) {
        createRelation(
          db,
          {
            sourceType: "setting",
            sourceId: id,
            targetType: "setting",
            targetId: targetParent,
            relationType: "belongs_to",
          },
          outlineDir,
        );
      }
 // 删旧边：按旧父 target_id 精确匹配——**不能按 source_id 删**（刚建的新边同 source，
 // 会连同被删导致改父结果丢失，debug 实测踩坑）；一设定一父，至多一条
      if (currentParent !== null) {
        const oldRows = q
          .select({ id: relationRecords.id })
          .from(relationRecords)
          .where(
            and(
              eq(relationRecords.source_type, "setting"),
              eq(relationRecords.source_id, id),
              eq(relationRecords.target_id, currentParent),
              eq(relationRecords.relation_type, "belongs_to"),
              eq(relationRecords.target_type, "setting"),
              isNull(relationRecords.deleted_at),
            ),
          )
          .all();
        for (const r of oldRows) {
          deleteRelation(db, r.id); // 手动删关系 = 物理删
        }
      }
    }
 // 目标同级组（改父后按新边计算：新父子级组 / 根 = 无父设定组）
    const edgesAfter = listSettingHierarchyEdges(db);
    const parentOfAfter = new Map(edgesAfter.map((e) => [e.childId, e.parentId]));
    let groupIds: string[];
    if (targetParent === null) {
      const all = q
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.type, "setting"), isNull(entities.deleted_at)))
        .all();
      groupIds = all.map((r) => r.id).filter((gid) => !parentOfAfter.has(gid));
    } else {
      groupIds = edgesAfter.filter((e) => e.parentId === targetParent).map((e) => e.childId);
    }
 // 组内排齐（NULL 沉底 → sort_order → name → id，与 SQLite 排序语义一致）；
 // inArray 空集生成恒假 SQL（无组 → 空集，原 IN (NULL) 语义等价）
    const rows = (
      q
        .select({ id: entities.id, name: entities.name, sort_order: entities.sort_order, updated_at: entities.updated_at })
        .from(entities)
        .where(inArray(entities.id, groupIds))
        .all()
    ).sort((a, b) => {
      const ao = a.sort_order === null ? 1 : 0;
      const bo = b.sort_order === null ? 1 : 0;
      if (ao !== bo) return ao - bo;
      const av = a.sort_order ?? 0;
      const bv = b.sort_order ?? 0;
      if (av !== bv) return av - bv;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    const idx = rows.findIndex((r) => r.id === id);
    const moved = idx >= 0 ? rows.splice(idx, 1)[0] : { id, name: "", sort_order: null, updated_at: row.updated_at };
 // order 缺省 = 组尾；clamp 到 [0, 剩余数]（负数 400 schema 拒绝，此处防御）
    const pos = input.order === undefined
      ? rows.length
      : Math.max(0, Math.min(Math.trunc(input.order), rows.length));
    rows.splice(pos, 0, moved);
 // 热循环：builder 每次 .run 重新编译 SQL（prepare 不复用）；数据量小可接受（边界）
    const now = nowIso();
    for (let i = 0; i < rows.length; i++) {
      q.update(entities)
        .set({ sort_order: i, updated_at: rows[i].id === id ? now : rows[i].updated_at })
        .where(eq(entities.id, rows[i].id))
        .run();
    }
    return { moved: true };
  });
}

/**
 * 事件当前挂载的时间点关系（G2 occurs_at，timepoint → event 1:n）：
 * 查事件未软删的 occurs_at 挂载（source 为 timepoint 且 timepoint 本身未软删——
 * timepoint 软删时其 occurs_at 被级联软删，此处 EXISTS 校验是防御纵深）。
 * 供 1:n 挂载校验（assertEventSingleOccursAt）与前端展示（G2.3 时间轴渲染）使用。
 * @returns 挂载关系（RelationRow，source_id = timepoint id）；未挂载/关系软删/timepoint 软删 → null
 */
export function eventOccursAt(db: Db, eventId: string): RelationRow | null {
  const row = queryDb(db)
    .select()
    .from(relationRecords)
    .where(
      and(
        eq(relationRecords.target_type, "event"),
        eq(relationRecords.target_id, eventId),
        eq(relationRecords.relation_type, "occurs_at"),
        isNull(relationRecords.deleted_at),
        eq(relationRecords.source_type, "timepoint"),
 // EXISTS 防御：timepoint 软删时 occurs_at 已级联软删，
 // 此处兜底校验 source 端点未软删（跨表互引，sql 模板表达，4A 允许）
        sql`EXISTS (SELECT 1 FROM entities e WHERE e.id = ${relationRecords.source_id} AND e.deleted_at IS NULL)`,
      ),
    )
    .get() as unknown as Record<string, unknown> | undefined;
  return row === undefined ? null : rowToRelationRow(row);
}

/**
 * occurs_at 1:n 挂载校验（G2，一个事件至多挂一个时间点）：
 * 建 occurs_at 前调用——事件已有未软删挂载 → 抛 RelationError（EVENT_ALREADY_MOUNTED，
 * 与现有关系校验风格一致，G2.2 路由层 catch 映射 409）。
 * 未挂载 → 无副作用（void），可继续建关系。
 * @throws RelationError EVENT_ALREADY_MOUNTED（已挂载）
 */
export function assertEventSingleOccursAt(db: Db, eventId: string): void {
  const mounted = eventOccursAt(db, eventId);
  if (mounted !== null) {
    throw new RelationError(
      "EVENT_ALREADY_MOUNTED",
      `事件已挂载时间点 ${mounted.source_id}，重复挂载拒绝（occurs_at 1:n 约束，G2）`,
    );
  }
}

/**
 * 批量重排时间标签点（G2，注记：LLM 按时间点 name 语义排序 → 提案确认后执行）：
 * 1. 事务内读出当前全部未软删 timepoint id 集合（listTimepoints 同款序）
 * 2. **校验 orderedIds 与当前集合完全相等**（缺/多/重复 → 抛错）——正常由提案 references
 * 快照校验先拦截，此处为防御纵深（LLM 幻觉漏时间点 / 确认前用户已拖拽增删）
 * 3. 按 orderedIds 序重写全部 timepoint sort_order 0..n-1
 * 4. **全部时间点 updated_at 统一刷新为 nowIso**——批量重排是**全量变化**，与
 * moveTimepoint 只刷被移单行区分
 *
 * @returns 重排时间点数（n）
 */
export function reorderTimepoints(db: Db, orderedIds: string[], nowIsoTimestamp: string): number {
  return withTransaction(db, () => {
    const rows = listTimepoints(db);
    const currentIds = new Set(rows.map((r) => r.id));
    const orderedSet = new Set(orderedIds);
 // 缺失 = 当前集合有而新序没有（漏时间点，LLM 幻觉）；多余 = 新序含当前集合没有的 id（不存在/已软删）
    const missing = rows.map((r) => r.id).filter((id) => !orderedSet.has(id));
    const extra = orderedIds.filter((id) => !currentIds.has(id));
    if (orderedSet.size !== orderedIds.length || missing.length > 0 || extra.length > 0) {
      const dup = orderedSet.size !== orderedIds.length ? "（含重复）" : "";
      const brief = (ids: string[]): string =>
        ids.length === 0 ? "" : `（${ids.slice(0, 5).join(", ")}${ids.length > 5 ? "…" : ""}）`;
      throw new Error(
        `时间点集合与当前时间轴不一致${dup}: 缺失 ${missing.length} 个${brief(missing)}、多余 ${extra.length} 个${brief(extra)}`,
      );
    }
    const q = queryDb(db);
 // 热循环：同 moveEvent（混合风格边界注释）
    for (let i = 0; i < orderedIds.length; i++) {
      q.update(entities)
        .set({ sort_order: i, updated_at: nowIsoTimestamp })
        .where(eq(entities.id, orderedIds[i]))
        .run();
    }
    return orderedIds.length;
  });
}

/**
 * 软删实体（DELETE /api/v1/entity/:type/:id）：
 * **级联软删关联关系与 Delta**（单库内事务保证原子性）：
 * - relation_records：source_id = id **或** target_id = id（任一端点软删即不可见）
 * - delta_records：target_id = id（目标实体软删即不可见）
 * - 自身：deleted_at 置位 + updated_at 刷新（软删亦更新版本戳）
 * 幂等：实体已软删（或不存在）→ 返回 null 且无任何副作用（级联 UPDATE 均带 deleted_at IS NULL 过滤）。
 *
 * @returns { relations, deltas } 实际级联行数；实体不存在/已软删返回 null
 */
export function softDeleteEntity(db: Db, id: string, deletedAt: string): { relations: number; deltas: number } | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const exists = q.select({ id: entities.id }).from(entities).where(and(eq(entities.id, id), isNull(entities.deleted_at))).get();
    if (exists === undefined) return null;
    const rel = q
      .update(relationRecords)
      .set({ deleted_at: deletedAt })
      .where(
        and(
          isNull(relationRecords.deleted_at),
          or(eq(relationRecords.source_id, id), eq(relationRecords.target_id, id)),
        ),
      )
      .run();
    const delta = q
      .update(deltaRecords)
      .set({ deleted_at: deletedAt })
      .where(and(isNull(deltaRecords.deleted_at), eq(deltaRecords.target_id, id)))
      .run();
    q.update(entities)
      .set({ deleted_at: deletedAt, updated_at: deletedAt })
      .where(and(eq(entities.id, id), isNull(entities.deleted_at)))
      .run();
    return { relations: rel.changes, deltas: delta.changes };
  });
}

// ============ 聚合统计（S6.3 工具 get_entity_summary 下沉，「聚合分析」） ============

/** 实体聚合统计结果：总数 + 类型专属分布（稀疏字段，仅出现对应类型的分布） */
export interface EntitySummaryStats {
  type: EntityType;
 /** 非软删实体总数（回收站对象不计入） */
  total: number;
 /** character：data.role 分布 */
  byRole?: Record<string, number>;
 /** character / hook：data.status 分布 */
  byStatus?: Record<string, number>;
 /** setting：data.rules 标签分布（分类由 tags 承接，数组展平计数） */
  byTags?: Record<string, number>;
 /** location：data.type 分布 */
  byType?: Record<string, number>;
 /** hook：data.payoff_timing 分布 */
  byPayoffTiming?: Record<string, number>;
 /** character：data.abilities 频率（取前 10，防 token 爆炸） */
  topAbilities?: { ability: string; count: number }[];
}

/** 标签数组直方图（rules 数组展平计数；非字符串项/空串不计入） */
function countTags(values: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    if (Array.isArray(v)) {
      for (const t of v) {
        if (typeof t === "string" && t !== "") {
          out[t] = (out[t] ?? 0) + 1;
        }
      }
    }
  }
  return out;
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
 * 实体聚合统计（S6.3 工具 get_entity_summary 下沉，「聚合分析」）：
 * 指定类型实体的总数 + 类型专属分布。仅统计非软删实体；
 * 分布字段按类型稀疏出现：character→byRole/byStatus/topAbilities、setting→byTags、
 * location→byType、hook→byStatus/byPayoffTiming；缺字段（data 未填）不报错、不计入。
 */
export function getEntitySummaryStats(db: Db, type: EntityType): EntitySummaryStats {
  const rows = queryDb(db)
    .select({ data: entities.data })
    .from(entities)
    .where(and(eq(entities.type, type), isNull(entities.deleted_at)))
    .all() as unknown as Array<Record<string, unknown>>;

  const result: EntitySummaryStats = { type, total: rows.length };
  const dataOf = (r: Record<string, unknown>): Record<string, unknown> => parseDataColumn(r.data);
  switch (type) {
    case "character":
      result.byRole = countBy(rows.map((r) => dataOf(r).role));
      result.byStatus = countBy(rows.map((r) => dataOf(r).status));
      result.topAbilities = topAbilityCounts(rows, 10);
      break;
    case "setting":
 // K2（2026-08）：分类由 data.tags 承接——分布统计标签（数组展平计数）
      result.byTags = countTags(rows.map((r) => dataOf(r).tags));
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
