// @whispering233/ai-editor-db 关系管理（S3.2）：查询（k 跳遍历）/ 创建（判重）/ 物理删除
//
// 第 304-391 行（关系端点）、（通用关系表）、
// （关系可见性联动端点状态：任一端点软删即不可见；手动删关系 = 物理删）、
// （plot_edge 剧情连线同规则处理）。
//
// 可见性过滤实现：
// - SQL 层：关系自身 deleted_at IS NULL + 各过滤条件
// - JS 层（统一处理两端点）：实体端点查 entities 软删集合（一次 IN 查询）；
// 大纲端点读 outline.json（readOutlineFile 收集 deleted 节点 id 集合）
// - name 联表填充同路径：实体查 entities.name、大纲节点用 outline.json title
//
// 级联软删：S3.1 的 softDeleteEntity 已内联 relation_records 级联 UPDATE（source_id/target_id
// 命中即标 deleted_at）——本卡不重复实现，注释确认。
//
//：**全部查询经 queryDb 走 drizzle 构建器**（混合风格 4A）。
// 语义逐句对照旧实现（git show 52c7c13^:packages/db/src/queries/relation.ts）:
// - deleted_at IS NULL ↔ isNull；deleted_at IS NOT NULL ↔ isNotNull；IN 占位符 ↔ inArray；
// 动态 where 拼接 ↔ and(...)(SQL[])；ORDER BY r.created_at ↔ orderBy(relationRecords.created_at)
// - listSettingHierarchyEdges 的同表双 JOIN（s/t 别名，均 INNER + deleted_at IS NULL）
// ↔ drizzle alias(entities) 两次 innerJoin（同表两次需别名才可 join）
// - SELECT 1 判重 ↔ select({ id }) 存在性（语义等同：有行即重复）
// 事务/纯 JS 逻辑（collectPaths/buildEndpointContext 的 outline 部分/防环）不变。

import { findOutlineNode, readOutlineFile } from "../storage/outline.js";
import { getEntity } from "./entity.js";
import type { Db } from "../connection.js";
import type { OutlineFileNode, OutlineFileTree, RelationQueryResult, RelationRecord, RelationRow } from "@whispering233/ai-editor-shared";
import { generateId, relationTypeSyntaxError } from "@whispering233/ai-editor-shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { entities, relationRecords } from "../tables.js";
import { nowIso } from "../storage/atomic.js";
import { queryDb } from "../query-db.js";

/**
 * 关系操作错误码（server 层映射 HttpError：RELATION_EXISTS → 409、其余 → 400；
 * EVENT_ALREADY_MOUNTED（G2，时间轴挂载 1:n 校验，assertEventSingleOccursAt 抛出）→ 409
 * 由 G2.2 路由层映射，见 mapRelationError 注释）
 */
export type RelationErrorCode =
  | "RELATION_EXISTS"
  | "ENDPOINT_NOT_FOUND"
  | "INVALID_RELATION_TYPE"
  | "EVENT_ALREADY_MOUNTED"
 // （2026-08）：设定手动排序自指/成环（moveSetting 抛出，路由层映射 400）
  | "SETTING_CYCLE";

/** 关系操作错误（带 code，与 OutlineError 同风格；路由层 catch 映射） */
export class RelationError extends Error {
  readonly code: RelationErrorCode;
  constructor(code: RelationErrorCode, message: string) {
    super(message);
    this.name = "RelationError";
    this.code = code;
  }
}

/** 关系查询过滤条件（全部可选，组合过滤） */
export interface RelationQuery {
  sourceType?: string;
  sourceId?: string;
  targetType?: string;
  targetId?: string;
  relationType?: string;
}

/** 大纲端点 id（relation_records 端点类型约定） */
export const OUTLINE_ENDPOINT_TYPE = "outline_node";

/** 设定层级边：childId → parentId（belongs_to 且两端均为 setting，两端点未软删） */
export interface SettingHierarchyEdge {
  childId: string;
  parentId: string;
}

/** 实体端点类型集合（entities 表 type 列；含 event 时间轴事件——occurs_in 端点校验；
 * 含 timepoint 时间标签点——occurs_at 端点校验，G2） */
const ENTITY_ENDPOINT_TYPES = ["character", "setting", "location", "hook", "event", "timepoint"] as const;

/**
 * 构建可见性上下文：一次性收集两端点的软删集合与名称映射——
 * 实体端点走 entities 表（IN 查询），大纲端点走 outline.json（软删标记 + title）。
 */
function buildEndpointContext(
  db: Db,
  outlineDir: string,
  endpointIds: ReadonlySet<string>,
): { softDeleted: Set<string>; names: Map<string, string> } {
  const softDeleted = new Set<string>();
  const names = new Map<string, string>();
  const entityIds = [...endpointIds].filter((id) => id !== "root"); // root 非实体端点（无实际关系）
  if (entityIds.length > 0) {
    const q = queryDb(db);
 // 软删实体集合
    const softRows = q
      .select({ id: entities.id })
      .from(entities)
      .where(and(isNotNull(entities.deleted_at), inArray(entities.id, entityIds)))
      .all();
    for (const r of softRows) softDeleted.add(r.id);
 // 名称映射（含软删实体——名称填充不受可见性影响，过滤在另一层）
    const nameRows = q.select({ id: entities.id, name: entities.name }).from(entities).where(inArray(entities.id, entityIds)).all();
    for (const r of nameRows) names.set(r.id, r.name);
  }
 // 大纲端点：读一次树，收集软删节点与标题
  if (endpointIds.size > 0) {
    const tree = readOutlineFile(outlineDir);
 // 递归遍历（OutlineFileNode 联合：卷/章/场景，children 可选）
    const visit = (node: OutlineFileNode): void => {
      if (endpointIds.has(node.id)) {
        names.set(node.id, node.title);
        if (node.deleted === true) softDeleted.add(node.id);
      }
      const kids = (node as { children?: OutlineFileNode[] }).children;
      if (kids !== undefined) {
        for (const k of kids) visit(k);
      }
    };
    for (const child of tree.children) visit(child);
  }
  return { softDeleted, names };
}

/** 行 → RelationRow（metadata JSON 解析；坏行防御同 entity.ts parseDataColumn 风格） */
export function rowToRelationRow(row: Record<string, unknown>): RelationRow {
  return {
    id: row.id as string,
    source_type: row.source_type as string,
    source_id: row.source_id as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    relation_type: row.relation_type as string,
    metadata: parseMetadata(row.metadata),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/** metadata 列解析防御：非法 JSON / 非对象 → null（与 entity.ts 同风格） */
function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 关系列表 + k 跳路径（GET /api/v1/relation）：
 * 过滤条件组合（全部可选）+ 可见性过滤（关系自身未软删 + 两端点均未软删）。
 * depth=1：直接关系（relations，联表填充 sourceName/targetName）。
 * depth=2/3：追加 k 跳路径（paths：nodes/edges 结构）——**BFS 图不受 source_id/target_id
 * 过滤限制**（起点定位用 source_id，图遍历需要全量可见边，否则中间节点的出边被过滤截断）；
 * relations 数组仍按全部过滤条件返回（「追加路径信息」语义）。
 *
 * @param outlineDir 项目根（大纲端点软删/标题校验读 outline.json）
 */
export function listRelations(
  db: Db,
  query: RelationQuery,
  depth: 1 | 2 | 3,
  outlineDir: string,
): RelationQueryResult {
 // relations 查询：全部过滤条件（source/target 参与）
  const relationRows = queryRelationRows(db, query, true);
 // BFS 图查询（depth>=2）：仅 type/relation_type 过滤，source_id/target_id 不参与
  const graphRows = depth >= 2 ? queryRelationRows(db, query, false) : [];

  const endpointIds = new Set<string>();
  for (const r of relationRows) {
    endpointIds.add(r.source_id);
    endpointIds.add(r.target_id);
  }
  const ctx = buildEndpointContext(db, outlineDir, endpointIds);
  const visible = relationRows.filter(
    (r) => !ctx.softDeleted.has(r.source_id) && !ctx.softDeleted.has(r.target_id),
  );

 // name 联表填充
  const records: RelationRecord[] = visible.map((r) => ({
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    ...(ctx.names.has(r.source_id) ? { sourceName: ctx.names.get(r.source_id) } : {}),
    targetType: r.target_type,
    targetId: r.target_id,
    ...(ctx.names.has(r.target_id) ? { targetName: ctx.names.get(r.target_id) } : {}),
    relationType: r.relation_type,
    ...(r.metadata !== null ? { metadata: r.metadata } : {}),
    createdAt: r.created_at,
  }));

  if (depth === 1) {
    return { relations: records };
  }
 // BFS 图的可见性过滤（独立上下文——图端点集合与 relations 端点集合不同）
  const graphEndpointIds = new Set<string>();
  for (const r of graphRows) {
    graphEndpointIds.add(r.source_id);
    graphEndpointIds.add(r.target_id);
  }
  const graphCtx = buildEndpointContext(db, outlineDir, graphEndpointIds);
  const graph = graphRows.filter(
    (r) => !graphCtx.softDeleted.has(r.source_id) && !graphCtx.softDeleted.has(r.target_id),
  );
  return { relations: records, paths: collectPaths(graph, graphCtx.names, query, depth) };
}

/** 查询关系行：includeSourceTarget=false 时跳过 source_id/target_id 过滤（BFS 全图模式） */
function queryRelationRows(db: Db, query: RelationQuery, includeSourceTarget: boolean): RelationRow[] {
  const conditions = [isNull(relationRecords.deleted_at)];
  if (query.sourceType !== undefined) conditions.push(eq(relationRecords.source_type, query.sourceType));
  if (includeSourceTarget && query.sourceId !== undefined) conditions.push(eq(relationRecords.source_id, query.sourceId));
  if (query.targetType !== undefined) conditions.push(eq(relationRecords.target_type, query.targetType));
  if (includeSourceTarget && query.targetId !== undefined) conditions.push(eq(relationRecords.target_id, query.targetId));
  if (query.relationType !== undefined) conditions.push(eq(relationRecords.relation_type, query.relationType));
  const rows = queryDb(db)
    .select()
    .from(relationRecords)
    .where(and(...conditions))
    .orderBy(relationRecords.created_at)
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map(rowToRelationRow);
}

/**
 * k 跳路径收集（depth=2/3）：
 * 有向 BFS（沿 source→target 出边）——关系有方向，遍历沿建立方向；
 * 起点 = query.sourceId（缺省时多起点：所有满足 sourceType 过滤的节点）。
 * 防环：路径级 visited（同一条路径不重复经过节点；不同路径可共享节点）。
 * depth=3 语义：3 层内可达图（「全量」= 3 层上限 + visited 防环，避免无限图爆炸）。
 * 每条路径输出 { nodes: [{type,id,name}...], edges: [{from,to,relationType}...] }，
 * 起点 → 终点方向；name 缺失时用 id 占位（端点不在关系集合中时理论上不可达）。
 */
function collectPaths(
  visible: RelationRow[],
  names: Map<string, string>,
  query: RelationQuery,
  depth: 2 | 3,
): NonNullable<RelationQueryResult["paths"]> {
 // 邻接表（出边）
  const adj = new Map<string, Array<{ toId: string; toType: string; relationType: string }>>();
  for (const r of visible) {
    const list = adj.get(r.source_id) ?? [];
    list.push({ toId: r.target_id, toType: r.target_type, relationType: r.relation_type });
    adj.set(r.source_id, list);
  }
 // 起点集合：sourceId 优先；缺省时所有出现过的节点（满足过滤条件的图内节点）
  const allIds = new Set<string>();
  for (const r of visible) {
    allIds.add(r.source_id);
    allIds.add(r.target_id);
  }
  const starts = query.sourceId !== undefined ? [query.sourceId] : [...allIds];

  const nameOf = (id: string): string => names.get(id) ?? id;
  const typeOf = new Map<string, string>();
  for (const r of visible) {
    typeOf.set(r.source_id, r.source_type);
    typeOf.set(r.target_id, r.target_type);
  }

  const paths: NonNullable<RelationQueryResult["paths"]> = [];
  for (const start of starts) {
    if (typeOf.get(start) === undefined) continue; // 起点不在图内（过滤条件外）——跳过
 // BFS：{ nodeId, nodes, edges }，路径级 visited 防环
    type BfsItem = { nodeId: string; nodes: { type: string; id: string; name: string }[]; edges: { from: string; to: string; relationType: string }[] };
    const queue: BfsItem[] = [
      {
        nodeId: start,
        nodes: [{ type: typeOf.get(start)!, id: start, name: nameOf(start) }],
        edges: [],
      },
    ];
    for (let level = 1; level <= depth && queue.length > 0; level++) {
      const levelCount = queue.length;
      for (let i = 0; i < levelCount; i++) {
        const item = queue.shift()!;
        const outEdges = adj.get(item.nodeId) ?? [];
        for (const edge of outEdges) {
 // 路径级防环：目标已在当前路径上则跳过
          if (item.nodes.some((n) => n.id === edge.toId)) continue;
          const path: BfsItem = {
            nodeId: edge.toId,
            nodes: [...item.nodes, { type: edge.toType, id: edge.toId, name: nameOf(edge.toId) }],
            edges: [...item.edges, { from: item.nodeId, to: edge.toId, relationType: edge.relationType }],
          };
          paths.push({ nodes: path.nodes, edges: path.edges });
          if (level < depth) queue.push(path);
        }
      }
    }
  }
  return paths;
}

/**
 * 单条关系（含可见性过滤）；不存在/不可见返回 null。
 * @param outlineDir 大纲端点软删校验读 outline.json
 */
export function getRelation(db: Db, id: string, outlineDir: string): RelationRow | null {
  const row = queryDb(db)
    .select()
    .from(relationRecords)
    .where(and(eq(relationRecords.id, id), isNull(relationRecords.deleted_at)))
    .get() as unknown as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  const relation = rowToRelationRow(row);
  const ctx = buildEndpointContext(db, outlineDir, new Set([relation.source_id, relation.target_id]));
  if (ctx.softDeleted.has(relation.source_id) || ctx.softDeleted.has(relation.target_id)) {
    return null;
  }
  return relation;
}

/**
 * 创建关系（POST /api/v1/relation）：
 * - **判重**：同 (source_id, target_id, relation_type) 且未软删已存在 → RELATION_EXISTS（409 语义）
 * - relation_type **语法校验**（卡片 8.2：自由字符串 = 预定义 17 类 ∪ 自定义类型；
 *   `trim` 非空 / ≤ 32 / 禁控制字符 —— 与 REST schema、client 预校验同一 shared 纯函数）
 * - **端点存在性**：实体端点查 entities（非软删）、大纲端点读 outline.json（存在且非软删）
 * - 时间戳应用层 ISO
 *
 * @param outlineDir 大纲端点校验读 outline.json
 * @throws RelationError RELATION_EXISTS / ENDPOINT_NOT_FOUND / INVALID_RELATION_TYPE
 */
export function createRelation(
  db: Db,
  input: {
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationType: string;
    metadata?: Record<string, unknown>;
  },
  outlineDir: string,
): RelationRow {
  const relationTypeError = relationTypeSyntaxError(input.relationType);
  if (relationTypeError !== null) {
    throw new RelationError(
      "INVALID_RELATION_TYPE",
      `非法关系类型（${relationTypeError}）: ${input.relationType}`,
    );
  }
 // 端点存在性（软删端点不可建立新关系）
  assertEndpointExists(db, outlineDir, input.sourceType, input.sourceId);
  assertEndpointExists(db, outlineDir, input.targetType, input.targetId);
 // 判重（同三元组未软删即视为已存在）
  const dup = queryDb(db)
    .select({ id: relationRecords.id })
    .from(relationRecords)
    .where(and(eq(relationRecords.source_id, input.sourceId), eq(relationRecords.target_id, input.targetId), eq(relationRecords.relation_type, input.relationType), isNull(relationRecords.deleted_at)))
    .get();
  if (dup !== undefined) {
    throw new RelationError("RELATION_EXISTS", `关系已存在: ${input.sourceId} → ${input.targetId} (${input.relationType})`);
  }
  const now = nowIso();
 // 关系 id：id 约定未列 rel- 前缀（运行时对象为 prop_/call_/会话 id），
 // 用 generateId("rel-") 保证唯一（前缀 + nanoid，与实体/节点同构）
  const row: RelationRow = {
    id: generateId("rel-"),
    source_type: input.sourceType,
    source_id: input.sourceId,
    target_type: input.targetType,
    target_id: input.targetId,
    relation_type: input.relationType,
    metadata: input.metadata ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  queryDb(db)
    .insert(relationRecords)
    .values({
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      target_type: row.target_type,
      target_id: row.target_id,
      relation_type: row.relation_type,
 // metadata 为可空 text 列（JSON 扩展元数据，JSON.stringify 序列化写入；null 直接写空）
      metadata: row.metadata === null ? null : JSON.stringify(row.metadata),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
    .run();
  return row;
}

/** 端点存在性校验（实体非软删 / 大纲节点存在非软删） */
function assertEndpointExists(db: Db, outlineDir: string, type: string, id: string): void {
  if (id === "root") {
    throw new RelationError("ENDPOINT_NOT_FOUND", `端点不存在或已软删: ${type}/${id}`);
  }
  if ((ENTITY_ENDPOINT_TYPES as readonly string[]).includes(type)) {
    if (getEntity(db, id) === null) {
      throw new RelationError("ENDPOINT_NOT_FOUND", `端点不存在或已软删: ${type}/${id}`);
    }
    return;
  }
  if (type === OUTLINE_ENDPOINT_TYPE) {
    const tree = readOutlineFile(outlineDir);
    const node = findOutlineNode(tree, id);
    if (node === undefined || node.deleted === true) {
      throw new RelationError("ENDPOINT_NOT_FOUND", `端点不存在或已软删: ${type}/${id}`);
    }
    return;
  }
  throw new RelationError("ENDPOINT_NOT_FOUND", `非法端点类型: ${type}`);
}

/**
 * 全量设定层级边（2026-08）：读取所有 setting→setting 的 belongs_to 边
 * （两端点均未软删——可见性联动，软删端点不参与层级）。供防环校验与设定树
 * 构建使用：O(N) 一次读取构建内存邻接表，避免逐条查询（用户反馈 #1 性能方案：JSON 内
 * parent_id 需全表扫 + parse，关系表走索引）。方向：childId → parentId（child belongs_to parent）。
 */
export function listSettingHierarchyEdges(db: Db): SettingHierarchyEdge[] {
 // 同表双 JOIN（source 实体 / target 实体均为非软删 setting）——IDs 的表对象在 FROM 中已占用，
 // 二次 join 需 alias 区分（s/t，语义与旧实现 SELECT R JOIN entities s JOIN entities t 一致）
  const sourceEntities = alias(entities, "s");
  const targetEntities = alias(entities, "t");
  const rows = queryDb(db)
    .select({ childId: relationRecords.source_id, parentId: relationRecords.target_id })
    .from(relationRecords)
    .innerJoin(sourceEntities, and(eq(sourceEntities.id, relationRecords.source_id), isNull(sourceEntities.deleted_at)))
    .innerJoin(targetEntities, and(eq(targetEntities.id, relationRecords.target_id), isNull(targetEntities.deleted_at)))
    .where(
      and(
        eq(relationRecords.relation_type, "belongs_to"),
        eq(relationRecords.source_type, "setting"),
        eq(relationRecords.target_type, "setting"),
        isNull(relationRecords.deleted_at),
      ),
    )
    .all();
  return rows.map((r) => ({ childId: r.childId, parentId: r.parentId }));
}

/**
 * 设定层级防环校验：判断建边 child → newParent 是否成环。
 * 规则：newParent 沿父链（child→parent 边）向上走，经过 child 即成环（child 将成为自身祖先）；
 * 祖先链查询 O(深度)；child 不在树中（新建场景）时必为 false；child 与 newParent 相同 = 自指环。
 */
export function wouldCreateSettingCycle(db: Db, childId: string, newParentId: string): boolean {
  if (childId === newParentId) return true;
  const parentOf = new Map<string, string>();
  for (const e of listSettingHierarchyEdges(db)) parentOf.set(e.childId, e.parentId);
  let cur: string | undefined = newParentId;
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === childId) return true;
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return false;
}

/**
 * 物理删除关系（DELETE /api/v1/relation/:id，
 * 手动删关系 = 物理删，不进回收站）。
 * @returns 影响行数（0 = 不存在，路由层映射 404 RELATION_NOT_FOUND）
 */
export function deleteRelation(db: Db, id: string): number {
  return queryDb(db).delete(relationRecords).where(eq(relationRecords.id, id)).run().changes;
}

/**
 * 更新关系元数据（PUT /api/v1/relation/:id，「PUT /relation/:id」）：
 * metadata **整体替换**（非浅合并）——画布连线标签编辑传 `{ label }`，清空传 `{}`；
 * 同时刷新 updated_at（应用层 ISO，与全仓时间约定一致）。
 * 不存在或已软删（deleted_at IS NOT NULL）→ null（404 语义，软删关系不可编辑）。
 * 端点可见性不在此校验——编辑不改变三元组，与可见性无关。
 * @returns 更新后的 { id }；不存在/已软删 → null
 */
export function updateRelationMetadata(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
  updatedAt: string,
): { id: string } | null {
  const result = queryDb(db)
    .update(relationRecords)
    .set({ metadata: JSON.stringify(metadata), updated_at: updatedAt })
    .where(and(eq(relationRecords.id, id), isNull(relationRecords.deleted_at)))
    .run();
  return result.changes === 0 ? null : { id };
}

// ============ 悬空关系诊断（S6.4 工具 find_orphan_elements 下沉） ============

/** 悬空关系的端点异常原因（端点物理缺失 / 端点软删未级联） */
export type DanglingRelationReason = "source_missing" | "target_missing" | "source_deleted" | "target_deleted";

/** 悬空关系记录摘要（关系自身未软删但端点异常——每端点一条） */
export interface DanglingRelationInfo {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationType: string;
  reason: DanglingRelationReason;
}

/** 端点状态判定（实体查预构建批量 Map / 大纲节点查树；root 恒为正常——树根非关系端点但无害） */
function checkEndpointState(
  entityStates: ReadonlyMap<string, "ok" | "missing" | "deleted">,
  tree: OutlineFileTree,
  type: string,
  id: string,
): "ok" | "missing" | "deleted" {
  if (id === "root") return "ok";
  if ((ENTITY_ENDPOINT_TYPES as readonly string[]).includes(type)) {
    return entityStates.get(id) ?? "missing";
  }
  if (type === OUTLINE_ENDPOINT_TYPE) {
    const node = findOutlineNode(tree, id);
    return node === undefined ? "missing" : node.deleted === true ? "deleted" : "ok";
  }
  return "missing"; // 未知端点类型（脏数据）
}

/**
 * 全量悬空关系诊断（S6.4 工具 find_orphan_elements 下沉，「孤立元素」）：
 * 关系自身未软删，但端点异常——**每端点一条**记录（同一关系两端点异常时出两条）：
 * - *_missing：端点已物理删除（实体 purge / 大纲节点 purge）——dangling_relations 侧
 * - *_deleted：端点已软删但关系未级联软删（跨存储不一致的 relation 侧，
 * 级联软删/启动一致性校验兜底的对象同源）——inconsistent_soft_deletes 侧
 * 软删自身的关系（回收站对象）**不在此列**——由回收站管理，非悬空。
 * 实体端点状态一次 IN 批量收集（避免逐行查询——buildEndpointContext 同款先例）。
 * @param outlineDir 项目根（大纲端点存在性/软删校验读 outline.json）
 */
export function listDanglingRelations(db: Db, outlineDir: string): DanglingRelationInfo[] {
  const rows = queryDb(db)
    .select()
    .from(relationRecords)
    .where(isNull(relationRecords.deleted_at))
    .orderBy(relationRecords.created_at)
    .all() as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const tree = readOutlineFile(outlineDir);
 // 实体端点 id 集合（一次 IN 批量收集状态）
  const entityIds = new Set<string>();
  for (const raw of rows) {
    const r = rowToRelationRow(raw);
    if ((ENTITY_ENDPOINT_TYPES as readonly string[]).includes(r.source_type)) entityIds.add(r.source_id);
    if ((ENTITY_ENDPOINT_TYPES as readonly string[]).includes(r.target_type)) entityIds.add(r.target_id);
  }
  const entityStates = new Map<string, "ok" | "missing" | "deleted">();
  if (entityIds.size > 0) {
    const found = queryDb(db)
      .select({ id: entities.id, deleted_at: entities.deleted_at })
      .from(entities)
      .where(inArray(entities.id, [...entityIds]))
      .all() as unknown as Array<{ id: string; deleted_at: string | null }>;
    const foundIds = new Set(found.map((f) => f.id));
    for (const id of entityIds) {
      if (!foundIds.has(id)) {
        entityStates.set(id, "missing");
      } else {
        const f = found.find((x) => x.id === id)!;
        entityStates.set(id, f.deleted_at !== null ? "deleted" : "ok");
      }
    }
  }

  const out: DanglingRelationInfo[] = [];
  for (const raw of rows) {
    const r = rowToRelationRow(raw);
    const source = checkEndpointState(entityStates, tree, r.source_type, r.source_id);
    if (source !== "ok") {
      out.push({
        id: r.id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        targetType: r.target_type,
        targetId: r.target_id,
        relationType: r.relation_type,
        reason: source === "missing" ? "source_missing" : "source_deleted",
      });
    }
    const target = checkEndpointState(entityStates, tree, r.target_type, r.target_id);
    if (target !== "ok") {
      out.push({
        id: r.id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        targetType: r.target_type,
        targetId: r.target_id,
        relationType: r.relation_type,
        reason: target === "missing" ? "target_missing" : "target_deleted",
      });
    }
  }
  return out;
}
