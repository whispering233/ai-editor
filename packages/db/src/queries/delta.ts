// @whispering233/ai-editor-db Delta 增查（S5.1）：增量插入 + 按节点查询（联表 target_name + 可见性联动）
//
// 单一事实来源：
// - doc/api/endpoints.md 第 395-462 行（POST /delta 追加 + GET /delta/node/:nodeId；
//   DeltaRecord 含 targetName 联表字段；**无 order 入参**——服务端全局单调生成；
//   op 语义 2026-08 修订：set/update/add/remove）
// - doc/database/schema.md 第 89-105 行（delta_records 表：changes JSON、order 全局单调、
//   created_at/updated_at/deleted_at ISO 应用层写入）
// - 决策 12 修订（可见性联动触发节点与目标实体：任一软删即不可见）、
//   决策 9 修订（computeState 只沿大纲树父链累积已确认 Delta——同一节点内按 order 应用）
//
// 边界：级联软删/还原/补标已有实现——entity.ts softDeleteEntity（target_id 级联）、
// server outline.ts cascadeSoftDelete（node_id 级联）、trash.ts restore/purge 级联、
// S4.2 一致性补标；本卡只做增量插入与可见性查询，不重复。
//
// 可见性过滤实现（决策 12 修订，三态 AND）：
// - SQL 层：delta 自身 deleted_at IS NULL
// - JS 层（参照 relation.ts buildEndpointContext 模式）：
//   触发节点（node_id）未软删——outline.json 检查；
//   目标端点未软删——实体 target 查 entities 软删集合（一次 IN 查询），
//   大纲节点 target 走 outline.json
// - name 联表同路径：实体 → entities.name、大纲节点 → outline.json title

import type { DeltaChange, DeltaRecord, DeltaRow, OutlineFileTree } from "@whispering233/ai-editor-shared";
import { generateId, mapRowToDelta } from "@whispering233/ai-editor-shared";
import { nowIso } from "../storage/atomic.js";
import { withTransaction, type Db } from "../connection.js";
import { findOutlineNode, readOutlineFile } from "../storage/outline.js";

/**
 * 实体端点类型集合（entities 表 type 列；其余 target_type 按大纲节点处理，relation.ts 同款约定）。
 * 含 event（oracle 审查，决策 26）：event 虽不产生 Delta（client 下拉已过滤），但本集合是
 * 「实体 vs 大纲节点」端点分类——可见性软删过滤、targetName 联表（entities.name）与
 * 悬空诊断（listDanglingDeltas）需按实体处理，否则 event 目标会落入大纲节点分支：
 * targetName 缺失、实体 purge 后误报 target_missing。
 */
const ENTITY_TARGET_TYPES = ["character", "setting", "location", "hook", "event"] as const;

/** 行 → DeltaRow（changes JSON 解析；坏行防御同 entity.ts parseDataColumn 风格） */
function rowToDeltaRow(row: Record<string, unknown>): DeltaRow {
  return {
    id: row.id as string,
    node_id: row.node_id as string,
    target_type: row.target_type as string,
    target_id: row.target_id as string,
    changes: parseChanges(row.changes),
    description: row.description as string,
    order: row.order as number,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: (row.deleted_at as string | null) ?? null,
  };
}

/**
 * changes 列解析防御：非法 JSON / 非数组 → []（单条坏行不打挂整表查询；
 * 与 entity.ts parseDataColumn / chat.ts parseToolCalls 防御风格一致）
 */
function parseChanges(value: unknown): DeltaChange[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as DeltaChange[]) : [];
  } catch {
    return [];
  }
}

/** 追加入参（endpoints.md 第 402-419 行；无 order 字段——服务端生成） */
export interface InsertDeltaInput {
  /** 触发变更的大纲节点 ID */
  nodeId: string;
  targetType: string;
  targetId: string;
  changes: DeltaChange[];
  /** 人类可读描述 */
  description: string;
}

/**
 * 追加属性变更记录（POST /api/v1/delta，endpoints.md 第 397-434 行）：
 * - **order 服务端生成、全局单调递增**：SELECT COALESCE(MAX("order"), 0) + 1，包单库事务
 *   （better-sqlite3 同步单连接下读-写无竞态，事务保证跨语句原子与回滚语义）
 * - **前置约定：本层不校验触发节点/目标存在性**——endpoints.md POST /delta 未定义
 *   该错误码；指向不存在节点的记录会因可见性规则（决策 12 修订：触发节点缺失视同
 *   不可见、目标缺失仅省略 name）永久不可见。存在性校验由 S5.3 路由层负责。
 * - id = shared generateId("delta-")（与关系 generateId("rel-") 同构；mapping.test.ts
 *   的 "delta-1" 形状一致；前缀 + nanoid 全局唯一）
 * - created_at = updated_at = nowIso()（应用层写时间约定，schema.md 第 16 行）
 * @returns 完整行（DeltaRow，changes 已解析为数组）
 */
export function insertDelta(db: Db, input: InsertDeltaInput): DeltaRow {
  return withTransaction(db, () => {
    const now = nowIso();
    const order = (
      db.prepare('SELECT COALESCE(MAX("order"), 0) + 1 AS next FROM delta_records').get() as { next: number }
    ).next;
    const row: DeltaRow = {
      id: generateId("delta-"),
      node_id: input.nodeId,
      target_type: input.targetType,
      target_id: input.targetId,
      changes: input.changes,
      description: input.description,
      order,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    db.prepare(
      'INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.node_id,
      row.target_type,
      row.target_id,
      JSON.stringify(row.changes),
      row.description,
      row.order,
      row.created_at,
      row.updated_at,
    );
    return row;
  });
}

/**
 * 行数组 → 可见性三态过滤 + targetName 联表（决策 12 修订，AND）：
 * 1. delta 自身未软删（SQL 层 WHERE deleted_at IS NULL 保证，调用方负责）
 * 2. 触发节点未软删（outline.json：节点 deleted !== true；节点不存在视同不可见——
 *    purge 已物理清除其 Delta，脏引用兜底为空）——**逐行判定**（listDeltasByTarget
 *    的行可来自不同触发节点，listDeltasByNode 复用同一逻辑，语义幂等）
 * 3. 目标端点未软删：实体 target 查 entities 软删集合（一次 IN 查询）；大纲 target 查树
 *    （target 不存在 → 不过滤但省略 name——与 relation.ts 端点缺失语义一致）
 * - targetName 联表（参照 relation.ts buildEndpointContext）：实体 → entities.name
 *   （一次 IN 查询）；大纲节点 → outline.json title；解析失败/缺失 → 省略字段
 *
 * 供 listDeltasByNode / listDeltasByTarget 共用（S6.3 工具下沉：按目标查询复用同一语义）。
 * @param tree 已读取的 outline.json 树（调用方读取一次，避免重复 I/O）
 */
function filterVisibleDeltas(db: Db, rows: Array<Record<string, unknown>>, tree: OutlineFileTree): DeltaRecord[] {
  // 目标实体端点：一次 IN 查询收集软删集合与名称映射（含软删实体——名称填充不受
  // 可见性影响，过滤在另一层；relation.ts 同款取舍）。重复 target_id 用 Set 去重
  // （同一节点多条 Delta 指向同一实体时常见），避免 IN 参数重复
  const entityIds = [
    ...new Set(
      rows
        .filter((r) => (ENTITY_TARGET_TYPES as readonly string[]).includes(r.target_type as string))
        .map((r) => r.target_id as string),
    ),
  ];
  const entitySoftDeleted = new Set<string>();
  const entityNames = new Map<string, string>();
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => "?").join(",");
    const softRows = db
      .prepare(`SELECT id FROM entities WHERE deleted_at IS NOT NULL AND id IN (${placeholders})`)
      .all(...entityIds) as Array<{ id: string }>;
    for (const r of softRows) entitySoftDeleted.add(r.id);
    const nameRows = db
      .prepare(`SELECT id, name FROM entities WHERE id IN (${placeholders})`)
      .all(...entityIds) as Array<{ id: string; name: string }>;
    for (const r of nameRows) entityNames.set(r.id, r.name);
  }

  const records: DeltaRecord[] = [];
  for (const raw of rows) {
    const row = rowToDeltaRow(raw);
    // 触发节点软删检查（决策 12 修订：触发节点软删 → 该 Delta 不可见）
    const trigger = findOutlineNode(tree, row.node_id);
    if (trigger === undefined || trigger.deleted === true) continue;
    // 目标端点软删检查（决策 12 修订）
    let targetSoftDeleted: boolean;
    let targetName: string | undefined;
    if ((ENTITY_TARGET_TYPES as readonly string[]).includes(row.target_type)) {
      targetSoftDeleted = entitySoftDeleted.has(row.target_id);
      targetName = entityNames.get(row.target_id);
    } else {
      const node = findOutlineNode(tree, row.target_id);
      targetSoftDeleted = node !== undefined && node.deleted === true;
      if (node !== undefined) targetName = node.title;
    }
    if (targetSoftDeleted) continue;
    const record = mapRowToDelta(row); // shared 映射（camelCase；targetName 可选字段另行填充）
    if (targetName !== undefined) record.targetName = targetName;
    records.push(record);
  }
  return records;
}

/**
 * 按 id 取单条 Delta（S7.5 提案快照重校验，决策 14）：
 * 记录级查询——自身软删（deleted_at 非空）视为不存在返回 null；
 * 触发节点/目标端点的可见性联动（决策 12 修订）不在此判定：
 * 提案引用的对象是 delta_records 记录本身，「存在性 + 自身 updated_at」即决策 14 语义
 * （与 getRelation 的端点联动过滤不同——关系引用同样只比对关系自身，见 proposal/relation.ts
 * buildProposeRemoveRelation 只采集 refRelation）。
 * @returns 完整行（DeltaRow，changes 已解析）；不存在或已软删返回 null
 */
export function getDeltaRow(db: Db, id: string): DeltaRow | null {
  const row = db.prepare("SELECT * FROM delta_records WHERE id = ? AND deleted_at IS NULL").get(id) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) return null;
  return rowToDeltaRow(row);
}

/**
 * 按触发节点查询 Delta（GET /api/v1/delta/node/:nodeId，endpoints.md 第 436-462 行）：
 * - SQL：node_id = ? AND deleted_at IS NULL，按 "order" 递增（computeState 同节点内应用序）
 * - **可见性三态过滤（决策 12 修订，AND）**：见 filterVisibleDeltas（本函数行同属一个
 *   触发节点，仍逐行判定——与 listDeltasByTarget 共用同一实现，语义幂等）
 * @param outlineDir 项目根（触发节点与大纲 target 的软删/标题校验读 outline.json）
 */
export function listDeltasByNode(db: Db, nodeId: string, outlineDir: string): DeltaRecord[] {
  const rows = db
    .prepare('SELECT * FROM delta_records WHERE node_id = ? AND deleted_at IS NULL ORDER BY "order" ASC')
    .all(nodeId) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const tree = readOutlineFile(outlineDir);
  // 触发节点软删检查（决策 12 修订：触发节点软删 → 其全部 Delta 不可见；
  // 提前短路避免无谓的实体软删集合 IN 查询）
  const trigger = findOutlineNode(tree, nodeId);
  if (trigger === undefined || trigger.deleted === true) return [];

  return filterVisibleDeltas(db, rows, tree);
}

/**
 * 按目标端点查询 Delta（S6.3 工具 get_delta_history 下沉，tools.md「状态查询」）：
 * - SQL：target_id = ? AND deleted_at IS NULL，按 "order" 递增（order 全局单调 =
 *   创建顺序，即「按时间/节点排序」）
 * - 可见性过滤与 listDeltasByNode **完全一致**（filterVisibleDeltas 共享：delta 自身 /
 *   触发节点 / 目标端点三态软删判定 + targetName 联表，决策 12 修订）
 * @param outlineDir 项目根（触发节点与大纲 target 的软删/标题校验读 outline.json）
 */
export function listDeltasByTarget(db: Db, targetId: string, outlineDir: string): DeltaRecord[] {
  const rows = db
    .prepare('SELECT * FROM delta_records WHERE target_id = ? AND deleted_at IS NULL ORDER BY "order" ASC')
    .all(targetId) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const tree = readOutlineFile(outlineDir);
  return filterVisibleDeltas(db, rows, tree);
}

// ============ 悬空 Delta 诊断（S6.4 工具 find_orphan_elements 下沉） ============

/** 悬空 Delta 的不可见原因（决策 12 修订三态的后两态 + 脏引用兜底） */
export type DanglingDeltaReason = "trigger_missing" | "trigger_deleted" | "target_missing" | "target_deleted";

/** 悬空 Delta 记录摘要（delta 自身未软删但已不可见——「幽灵变更」） */
export interface DanglingDeltaInfo {
  id: string;
  nodeId: string;
  targetType: string;
  targetId: string;
  description: string;
  reason: DanglingDeltaReason;
}

/**
 * 全量悬空 Delta 诊断（S6.4 工具 find_orphan_elements 下沉，tools.md「孤立元素」）：
 * delta 自身未软删，但三态可见性（决策 12 修订）后两态命中——该记录永不生效：
 * - trigger_missing：触发节点已物理删除（purge 后脏引用）
 * - trigger_deleted：触发节点已软删但本 delta 未级联软删（跨存储不一致的 delta 侧，
 *   与 outline-ops 级联软删/启动一致性校验（决策 16 修订）兜底的对象同源）
 * - target_missing：目标端点已物理删除（实体 purge / 大纲节点 purge）
 * - target_deleted：目标端点已软删但本 delta 未级联软删
 * 软删自身的 delta（回收站对象）**不在此列**——由回收站管理，非悬空。
 * @param outlineDir 项目根（触发节点与大纲 target 的存在性/软删校验读 outline.json）
 */
export function listDanglingDeltas(db: Db, outlineDir: string): DanglingDeltaInfo[] {
  const rows = db
    .prepare('SELECT * FROM delta_records WHERE deleted_at IS NULL ORDER BY "order" ASC')
    .all() as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const tree = readOutlineFile(outlineDir);
  // 实体目标端点状态：一次 IN 批量收集（避免逐行查询——relation.ts buildEndpointContext 同款先例）
  const entityIds = [
    ...new Set(
      rows
        .filter((r) => (ENTITY_TARGET_TYPES as readonly string[]).includes(r.target_type as string))
        .map((r) => r.target_id as string),
    ),
  ];
  const entityStates = new Map<string, "ok" | "missing" | "deleted">();
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => "?").join(",");
    const found = db
      .prepare(`SELECT id, deleted_at FROM entities WHERE id IN (${placeholders})`)
      .all(...entityIds) as Array<{ id: string; deleted_at: string | null }>;
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

  const out: DanglingDeltaInfo[] = [];
  for (const raw of rows) {
    const row = rowToDeltaRow(raw);
    // 触发节点：缺失 → 脏引用；软删 → 未级联
    const trigger = findOutlineNode(tree, row.node_id);
    if (trigger === undefined) {
      out.push({ id: row.id, nodeId: row.node_id, targetType: row.target_type, targetId: row.target_id, description: row.description, reason: "trigger_missing" });
      continue;
    }
    if (trigger.deleted === true) {
      out.push({ id: row.id, nodeId: row.node_id, targetType: row.target_type, targetId: row.target_id, description: row.description, reason: "trigger_deleted" });
      continue;
    }
    // 目标端点：实体查批量 Map / 大纲节点查树
    let targetState: "ok" | "missing" | "deleted";
    if ((ENTITY_TARGET_TYPES as readonly string[]).includes(row.target_type)) {
      targetState = entityStates.get(row.target_id) ?? "missing";
    } else {
      const node = findOutlineNode(tree, row.target_id);
      targetState = node === undefined ? "missing" : node.deleted === true ? "deleted" : "ok";
    }
    if (targetState !== "ok") {
      out.push({
        id: row.id,
        nodeId: row.node_id,
        targetType: row.target_type,
        targetId: row.target_id,
        description: row.description,
        reason: targetState === "missing" ? "target_missing" : "target_deleted",
      });
    }
  }
  return out;
}
