// 伏笔专属只读端点：GET /api/v1/hook/expected?node_id= / GET /api/v1/hook/written-unresolved
// 契约：docs/api/30-api-entity.md「GET /api/v1/hook/expected」「GET /api/v1/hook/written-unresolved」。
//
// 为什么不走泛型 `GET /api/v1/entity/hook?filters=`：`expected_resolve_node_id` 是 hook 专属 data 语义，
// 通用 filters 只有 status / tags——把节点过滤塞进通用面等于让一条伏笔规则漏进所有实体类型的查询口径。
// /expected：响应 = 未软删 + `data.expected_resolve_node_id === node_id` + 状态未回收的伏笔
// （id / name / status），排序与 JSON 守卫的细节见 db `listExpectedHooks`；无分页（单章命中量天然很小）。
// /written-unresolved：「预计回收的章已写正文、伏笔仍未回收」的全书清单（与 analyze_hook_health 的
// `written_unresolved` 同源 = db `listHooksWrittenUnresolved` 单查询；章号走 `deriveChapterOrder`）；无参、无分页。
import { Hono } from "hono";
import { listExpectedHooks, listHooksWrittenUnresolved } from "@whispering233/ai-editor-db";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";

/** 伏笔路由（挂载于 /api/v1/hook，index.ts） */
export const hookRoutes = new Hono();

// GET /api/v1/hook/expected?node_id=<大纲节点 id> —— 写作页卷章导航栏「本章待回收 · N」
hookRoutes.get("/expected", (c) => {
  const nodeId = c.req.query("node_id");
  if (nodeId === undefined || nodeId === "") {
    throw new HttpError(400, "VALIDATION_ERROR", "缺少 node_id");
  }
  const project = requireCurrentProject();
  return c.json(ok({ items: listExpectedHooks(project.db, nodeId) }));
});

// GET /api/v1/hook/written-unresolved —— 伏笔页「已写未回收」（无参：全书命中量小）
hookRoutes.get("/written-unresolved", (c) => {
  const project = requireCurrentProject();
  return c.json(ok({ items: listHooksWrittenUnresolved(project.db, project.root) }));
});