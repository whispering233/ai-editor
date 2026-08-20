// 参考资料专属路由（决策 43，批次十一）：扫描重建索引端点
//
// 契约来源：doc/api/endpoints.md「POST /api/v1/reference/scan」、决策 43（文件 = 真相源，
// DB 索引 = 派生镜像；mtime 快照比对幂等全量）。实体 CRUD 走泛型 /api/v1/entity/reference
// （文件联动在 routes/entity.ts + routes/trash.ts 内部完成），本路由只承载参考资料专属端点。
import { Hono } from "hono";
import { ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";
import { scanReferences } from "../reference-files.js";

/** 参考资料路由（挂载于 /api/v1/reference，index.ts） */
export const referenceRoutes = new Hono();

// POST /api/v1/reference/scan —— 扫描重建索引（幂等全量比对；返回统计）
// 无项目 → 409 NO_PROJECT_OPEN（requireCurrentProject）；失败不抛错——errors 数组带回（解析容错）
referenceRoutes.post("/scan", (c) => {
  const project = requireCurrentProject();
  return c.json(ok(scanReferences(project.root, project.db)));
});
