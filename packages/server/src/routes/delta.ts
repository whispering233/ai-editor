// Delta 路由（S5.3）：POST /api/v1/delta（追加）/ GET /node/:nodeId（按节点查询）/ POST /compute（状态计算）
//
// 契约来源：doc/api/endpoints.md 第 395-510 行（Delta 变更追踪）、决策 9（computeState 累积规则）、
// 决策 12 修订（可见性联动）、S13.3 收紧（变更目标仅实体类型——大纲节点不可作为变更目标，
//   历史 outline_node 目标数据保留展示，创建路径拒绝）。
// 错误映射（对照 endpoints.md 错误码）：
//   参数校验失败 → 400 VALIDATION_ERROR（zod 抛错由 errorHandler 统一映射，含 fields；
//     per-op 必填字段（endpoints.md 第 407-418 行）因 op 而异、zod 无法表达，路由层补校验
//     → HttpError 400 VALIDATION_ERROR，与 entity.ts validateDataByType 同思路；
//     S13.3 target_type 白名单校验同此 400——schema 层 target_type 为宽松 z.string()，
//     收紧在路由层（shared schema 不动，同 S12.1 节点 data 校验模式））
//   触发节点不存在或已软删 → 404 OUTLINE_NODE_NOT_FOUND（POST /delta 与 /delta/compute 路由层前置校验；
//     POST /delta 契约虽未定义该错误码，但 db 层 insertDelta 不校验节点（delta.ts 注释：缺失节点记录
//     因可见性规则永久不可见），路由层拦截防死记录——oracle 建议）
//   目标实体不存在或已软删 → 404 ENTITY_NOT_FOUND（POST /delta/compute）
import { Hono } from "hono";
import { computeState, findOutlineNode, getEntity, insertDelta, listDeltasByNode, readOutlineFile } from "@whispering233/ai-editor-db";
import type { DeltaChange } from "@whispering233/ai-editor-shared";
import { ENTITY_TYPES, mapRowToDelta } from "@whispering233/ai-editor-shared";
import { deltaComputeReqSchema, deltaCreateReqSchema } from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";

/** Delta 路由（挂载于 /api/v1/delta，index.ts） */
export const deltaRoutes = new Hono();

/**
 * 前置校验大纲节点存在且未软删（oracle 建议，防死记录）：
 * db 层 insertDelta / computeState 均不校验触发节点存在性（契约未定义该错误码，delta.ts 注释），
 * 缺失节点记录会因可见性规则（决策 12 修订：触发节点缺失视同不可见）永久不可见，
 * 故路由层拦截并映射 404 OUTLINE_NODE_NOT_FOUND；computeState 的 getOutlinePathIds
 * 对缺失节点抛错（视为调用方 bug），同样由本校验先行兜底。
 */
function assertOutlineNode(project: ProjectContext, nodeId: string): void {
  const tree = readOutlineFile(project.root);
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined || node.deleted === true) {
    throw new HttpError(404, "OUTLINE_NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
}

/**
 * per-op 必填字段校验（endpoints.md 第 407-418 行）：
 *   op=set → to 必填；op=update → from+to 必填；op=add → value 必填；op=remove → value 必填。
 * deltaChangeSchema 的字段均 optional——必填语义因 op 而异，schema 层无法表达，
 * 由路由层按 op 分派校验（与 entity.ts validateDataByType「schema 之外按类型精校验」同思路）。
 * 不满足 → 400 VALIDATION_ERROR（message 注明 changes 下标与缺失字段）。
 */
function validateChangesByOp(changes: DeltaChange[]): void {
  for (let i = 0; i < changes.length; i++) {
    const { op, from, to, value } = changes[i];
    const missing: string[] = [];
    switch (op) {
      case "set":
        if (to === undefined) missing.push("to");
        break;
      case "update":
        if (from === undefined) missing.push("from");
        if (to === undefined) missing.push("to");
        break;
      case "add":
        if (value === undefined) missing.push("value");
        break;
      case "remove":
        if (value === undefined) missing.push("value");
        break;
    }
    if (missing.length > 0) {
      throw new HttpError(400, "VALIDATION_ERROR", `changes[${i}] op=${op} 缺少必填字段: ${missing.join("/")}`);
    }
  }
}

/**
 * 变更目标类型白名单校验（S13.3 收紧：仅实体类型——大纲节点代表的
 * 故事导致实体发生变更，节点结构化信息不应出现在变更记录中；历史 outline_node 目标数据保留展示，
 * 仅创建路径拒绝）。
 * **排除 event（C2 oracle 审查口径，决策 26）**：event（时间轴事件）不产生 Delta——
 * **本收紧覆盖 REST 创建路径**（API 直连）：client 目标下拉已过滤（delta-create.ts），
 * REST 层同步拒绝（不产生「死 Delta」：无字段清单可编辑、client 无管理入口）；
 * AI 提案通道（propose_add_delta）在 tools 层独立拒绝（proposal/delta.ts，同决策 26）。
 * 已存在的 event 目标历史数据仍按实体端点展示（db 层 ENTITY_TARGET_TYPES 已含 event，决策 26）。
 * schema 层 target_type 为宽松 z.string()（shared 不动），收紧在路由层
 * （与 S12.1 节点 data 按层级校验同模式）。不通过 → 400 VALIDATION_ERROR（参照 entity.ts parseTypeParam 错误风格）。
 */
function assertDeltaTargetType(targetType: string): void {
  const allowed = ENTITY_TYPES.filter((t) => t !== "event");
  if (!(allowed as readonly string[]).includes(targetType)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `非法变更目标类型: ${targetType}（变更目标仅限实体类型: ${allowed.join("/")}；event 不产生 Delta，决策 26）`,
    );
  }
}

// POST /api/v1/delta —— 追加属性变更（201；order 服务端全局单调生成）
// 校验顺序（oracle 建议）：schema → target_type 白名单（400，S13.3 请求形状校验，无 DB 读）→
//   触发节点存在性（404）→ per-op 必填（400）→ insert
deltaRoutes.post("/", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = deltaCreateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（含 fields）
  }
  const { node_id, target_type, target_id, changes, description } = parsed.data;
  assertDeltaTargetType(target_type); // S13.3：变更目标仅实体类型（shared schema 不动，路由层收紧）
  assertOutlineNode(project, node_id); // 触发节点必须存在且未软删（防死记录）
  validateChangesByOp(changes); // per-op 必填字段（endpoints.md 第 407-418 行）
  const row = insertDelta(project.db, {
    nodeId: node_id,
    targetType: target_type,
    targetId: target_id,
    changes,
    description,
  });
  return c.json(ok({ id: row.id, applied: mapRowToDelta(row) }), 201);
});

// GET /api/v1/delta/node/:nodeId —— 按触发节点查询（200）
// 契约未定义该端点 404（endpoints.md 第 436-462 行）：节点缺失/软删 → 空数组（listDeltasByNode
// 内置可见性三态过滤，触发节点缺失视同不可见），不 404。
deltaRoutes.get("/node/:nodeId", (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("nodeId");
  const deltas = listDeltasByNode(project.db, nodeId, project.root);
  return c.json(ok({ nodeId, deltas }));
});

// POST /api/v1/delta/compute —— 累积状态计算（决策 9，endpoints.md 第 464-510 行）
// 校验顺序（任务规格）：schema → at_node_id 存在性（404 OUTLINE_NODE_NOT_FOUND，
//   computeState 的 getOutlinePathIds 对缺失节点抛错——路由层先拦截）→ 目标实体存在性
//   （404 ENTITY_NOT_FOUND；computeState 对缺失/软删实体返回 null）→ computeState → 200
deltaRoutes.post("/compute", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = deltaComputeReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（含 fields）
  }
  const { target_type, target_id, at_node_id } = parsed.data;
  assertOutlineNode(project, at_node_id);
  if (getEntity(project.db, target_id) === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${target_id}`);
  }
  const result = computeState(project.db, project.root, {
    targetType: target_type,
    targetId: target_id,
    atNodeId: at_node_id,
  });
  if (result === null) {
    // 不可达防御分支（上面 getEntity 已确认实体存在；computeState 内部同源查询不会翻案）
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${target_id}`);
  }
  return c.json(ok(result));
});
