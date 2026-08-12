// 实体路由（S3.3）：GET 列表 / POST 创建 / GET 详情 / PUT 部分更新 / DELETE 软删 / PUT event move（C2，决策 26）
//
// 契约来源：doc/api/endpoints.md 第 124-276 行（实体 CRUD）+ 第 386-393 行（PUT /entity/event/:id/move）、
// 决策 12（软删级联）、决策 26（时间轴事件：全局线性序 sort_order，仅 event 使用）。
// 错误映射（对照 endpoints.md 错误码）：
//   type 参数非法 / 参数校验失败 → 400 VALIDATION_ERROR（zod 抛错由 errorHandler 统一映射，含 fields）
//   实体不存在或已软删 → 404 ENTITY_NOT_FOUND
import { Hono } from "hono";
import { countDeltasForEntity, createEntity, getEntity, listEntities, listRelations, moveEvent, nowIso, softDeleteEntity, updateEntity } from "@whispering233/ai-editor-db";
import type { EntityType } from "@whispering233/ai-editor-shared";
import { ENTITY_DATA_SCHEMAS, entityCreateReqSchema, entityListQuerySchema, entityMoveReqSchema, entityTypeSchema, entityUpdateReqSchema } from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";

/** 实体路由（挂载于 /api/v1/entity，index.ts） */
export const entityRoutes = new Hono();

/** 校验 :type 路径参数为合法实体类型（非法 → 400 VALIDATION_ERROR；trash 路由复用） */
export function parseTypeParam(type: string): EntityType {
  const parsed = entityTypeSchema.safeParse(type);
  if (!parsed.success) {
    throw new HttpError(400, "VALIDATION_ERROR", `非法实体类型: ${type}`);
  }
  return parsed.data;
}

/** 按类型精确校验 data（endpoints.md 第 211-216 行：各 type 的 data 字段 schema；宽松 record 之外的精校验） */
function validateDataByType(type: EntityType, data: Record<string, unknown>): void {
  const check = ENTITY_DATA_SCHEMAS[type].safeParse(data);
  if (!check.success) {
    throw check.error; // → errorHandler → 400 VALIDATION_ERROR（含 fields）
  }
}

// GET /api/v1/entity/:type —— 列表（q/offset/limit/sort/order；响应 camelCase）
entityRoutes.get("/:type", (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const parsed = entityListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) throw parsed.error;
  const { q, offset, limit, sort, order } = parsed.data;
  const result = listEntities(project.db, { type, q, offset, limit, sort, order });
  return c.json(
    ok({
      items: result.items, // EntitySummary（db 已提取：id/type/name/summary/createdAt/updatedAt，camelCase）
      total: result.total,
      offset: offset ?? 0,
      limit: limit ?? 50,
    }),
  );
});

// GET /api/v1/entity/:type/:id —— 详情（含紧邻 relations + deltaCount）
entityRoutes.get("/:type/:id", (c) => {
  const project = requireCurrentProject();
  parseTypeParam(c.req.param("type"));
  const id = c.req.param("id");
  const row = getEntity(project.db, id);
  if (row === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`);
  }
  const deltaCount = countDeltasForEntity(project.db, id);
  // relations 紧邻（S3.2：listRelations depth=1，任一端点软删即不可见，决策 12 修订；
  // outline.json 校验路径 = project.root）。
  // **双向邻接**（endpoints.md「紧邻 1 跳」未明示方向，产品语义为展示所有关联）：
  // source 方向（该实体作为起点） + target 方向（该实体作为终点）两次查询，
  // 按关系 id 去重（source 方向优先、保持稳定顺序；自环 A→A 两方向均命中但只出现一次）
  const sourceRels = listRelations(project.db, { sourceId: row.id }, 1, project.root).relations;
  const targetRels = listRelations(project.db, { targetId: row.id }, 1, project.root).relations;
  const seenIds = new Set<string>();
  const relations = [...sourceRels, ...targetRels].filter((r) => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });
  return c.json(
    ok({
      id: row.id,
      type: row.type,
      name: row.name,
      data: row.data,
      relations,
      deltaCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
});

// POST /api/v1/entity/:type —— 创建（name 必填 1-100；data 按类型精确校验；201）
entityRoutes.post("/:type", async (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const raw = await c.req.json().catch(() => null);
  const parsed = entityCreateReqSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  if (parsed.data.data !== undefined) {
    validateDataByType(type, parsed.data.data);
  }
  const row = createEntity(project.db, { type, name: parsed.data.name, data: parsed.data.data });
  return c.json(
    ok({ id: row.id, type: row.type, name: row.name, data: row.data, createdAt: row.created_at }),
    201,
  );
});

// PUT /api/v1/entity/:type/:id —— 部分更新（仅合并传入字段；data 浅合并）
entityRoutes.put("/:type/:id", async (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => null);
  const parsed = entityUpdateReqSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  if (parsed.data.data !== undefined) {
    validateDataByType(type, parsed.data.data);
  }
  const row = updateEntity(project.db, id, parsed.data);
  if (row === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`);
  }
  return c.json(ok({ id: row.id, updated: true }));
});

// PUT /api/v1/entity/event/:id/move —— 时间轴事件重排（决策 26，endpoints.md 第 386-393 行）
// 请求 { order }（0-based 全局事件线性序；越界 clamp：负数→0、超总数→末尾——db 层 moveEvent 语义）；
// 响应 200 { moved: true }；事件不存在或已软删 → 404 ENTITY_NOT_FOUND。
// 仅 event 支持（专端点路径）：其余实体类型无 sort_order 语义（endpoints.md 第 393 行）。
entityRoutes.put("/event/:id/move", async (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => null);
  const parsed = entityMoveReqSchema.safeParse(raw); // .strict()：未知键 → 400
  if (!parsed.success) throw parsed.error;
  const result = moveEvent(project.db, id, parsed.data.order, nowIso());
  if (result === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `事件不存在: ${id}`);
  }
  return c.json(ok({ moved: true }));
});

// DELETE /api/v1/entity/:type/:id —— 软删（决策 12：级联软删关系与 Delta，本体保留可还原）
entityRoutes.delete("/:type/:id", (c) => {
  const project = requireCurrentProject();
  parseTypeParam(c.req.param("type"));
  const id = c.req.param("id");
  const result = softDeleteEntity(project.db, id, nowIso());
  if (result === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`);
  }
  return c.json(
    ok({
      deleted: true,
      cascaded: { relations: result.relations, deltas: result.deltas },
    }),
  );
});
