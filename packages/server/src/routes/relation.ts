// 关系路由（S3.4）：GET / 查询（k 跳遍历）、POST / 创建（判重）、DELETE /:id 物理删
//
// 契约来源：doc/api/endpoints.md 第 304-391 行（关系管理）、决策 2（通用关系表）、
// 决策 12 修订（可见性联动端点状态；手动删关系 = 物理删）。
// 错误映射（db RelationError → HttpError，对照 endpoints.md 错误码）：
//   RELATION_EXISTS         → 409 RELATION_EXISTS（同三元组已存在，endpoints.md 第 372-374 行）
//   ENDPOINT_NOT_FOUND      → 400 VALIDATION_ERROR（端点不存在/软删是参数问题）
//   INVALID_RELATION_TYPE   → 400 VALIDATION_ERROR（白名单外——schema 层 enum 已拦截，防御分支）
//   DELETE 0 影响行         → 404 RELATION_NOT_FOUND
import { Hono } from "hono";
import { createRelation, deleteRelation, listRelations, RelationError } from "@whispering233/ai-editor-db";
import {
  relationCreateReqSchema,
  relationQuerySchema,
} from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";

/** 关系路由（挂载于 /api/v1/relation，index.ts） */
export const relationRoutes = new Hono();

// GET /api/v1/relation —— 查询（depth 必填 1|2|3；过滤条件组合；响应 camelCase）
relationRoutes.get("/", (c) => {
  const project = requireCurrentProject();
  const parsed = relationQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（depth 缺失/非法等，含 fields）
  }
  const { depth, source_type, source_id, target_type, target_id, relation_type } = parsed.data;
  // snake_case（请求约定）→ camelCase（db 层接口）；undefined 字段透传（db 可选过滤）。
  // depth 经 schema min(1).max(3) 校验，收窄断言到 db 的 1|2|3 字面量联合
  const result = listRelations(
    project.db,
    { sourceType: source_type, sourceId: source_id, targetType: target_type, targetId: target_id, relationType: relation_type },
    depth as 1 | 2 | 3,
    project.root,
  );
  return c.json(ok(result));
});

// POST /api/v1/relation —— 创建（判重 409；端点存在性校验；201）
relationRoutes.post("/", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = relationCreateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（含 relation_type enum 白名单、字段校验）
  }
  const { source_type, source_id, target_type, target_id, relation_type, metadata } = parsed.data;
  let row;
  try {
    row = createRelation(
      project.db,
      {
        sourceType: source_type,
        sourceId: source_id,
        targetType: target_type,
        targetId: target_id,
        relationType: relation_type,
        ...(metadata !== undefined ? { metadata } : {}),
      },
      project.root,
    );
  } catch (err) {
    throw mapRelationError(err);
  }
  return c.json(
    ok({
      id: row.id,
      relation: {
        sourceType: row.source_type,
        sourceId: row.source_id,
        targetType: row.target_type,
        targetId: row.target_id,
        relationType: row.relation_type,
      },
    }),
    201,
  );
});

// DELETE /api/v1/relation/:id —— 物理删除（决策 12 修订：不进回收站）
relationRoutes.delete("/:id", (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const changes = deleteRelation(project.db, id);
  if (changes === 0) {
    throw new HttpError(404, "RELATION_NOT_FOUND", `关系不存在: ${id}`);
  }
  return c.json(ok({ deleted: true as const }));
});

/** RelationError → HttpError 映射（文件头注释表） */
export function mapRelationError(err: unknown): never {
  if (err instanceof RelationError) {
    switch (err.code) {
      case "RELATION_EXISTS":
        throw new HttpError(409, "RELATION_EXISTS", err.message);
      case "ENDPOINT_NOT_FOUND":
      case "INVALID_RELATION_TYPE":
        throw new HttpError(400, "VALIDATION_ERROR", err.message);
    }
  }
  throw err instanceof Error ? err : new HttpError(500, "INTERNAL_ERROR", "关系操作失败");
}
