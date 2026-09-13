// 关系路由（S3.4）：GET / 查询（k 跳遍历）、POST / 创建（判重）、DELETE /:id 物理删
//
// （可见性联动端点状态；手动删关系 = 物理删）。
// **伏笔锚点仅章（卡片 1.3 + 5.2）**：plants/advances/resolves **无条件**要求源端为章大纲节点
// （assertHookRelationSourceChapter → 400 VALIDATION_ERROR）——卷/场景不承载伏笔标记；
// 「源端为实体」的反向组合（如 person → outline_node）无任何消费者（分析层只认
// outline_node → hook），落库即数据卫生问题，同样拒绝。
// 错误映射（db RelationError → HttpError，对照 错误码）：
// RELATION_EXISTS → 409 RELATION_EXISTS（同三元组已存在）
// EVENT_ALREADY_MOUNTED → 409 EVENT_ALREADY_MOUNTED（occurs_at 1:n 重复挂载，G2）
// ENDPOINT_NOT_FOUND → 400 VALIDATION_ERROR（端点不存在/软删是参数问题）
// INVALID_RELATION_TYPE → 400 VALIDATION_ERROR（白名单外——schema 层 enum 已拦截，防御分支）
// DELETE 0 影响行 → 404 RELATION_NOT_FOUND
import { Hono } from "hono";
import {
  assertEventSingleOccursAt,
  createRelation,
  deleteRelation,
  eventOccursAt,
  findOutlineNode,
  listRelations,
  nowIso,
  readOutlineFile,
  RelationError,
  updateRelationMetadata,
  wouldCreateSettingCycle,
} from "@whispering233/ai-editor-db";
import { HOOK_RELATION_TYPES } from "@whispering233/ai-editor-shared";
import {
  relationCreateReqSchema,
  relationQuerySchema,
  relationUpdateMetaReqSchema,
} from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";

/** 关系路由（挂载于 /api/v1/relation，index.ts） */
export const relationRoutes = new Hono();

/**
 * 伏笔关系源端校验（卡片 1.3 + 5.2）：`plants`/`advances`/`resolves` 的源端**必须是章大纲节点**。
 * - 源端不是大纲节点（实体等）→ 直接拒（卡片 5.2：反向组合无消费者，属数据卫生问题）；
 * - 源端是大纲节点但不是章（卷/场景）→ 拒（伏笔是章级叙事事件，与 Delta 锚点同口径）。
 *
 * **存在性/软删不在此报错**：交由 createRelation 的 ENDPOINT_NOT_FOUND → 400
 * VALIDATION_ERROR 统一处理（避免两处端点错误文案漂移）——仅当节点存在且未软删时校验层级。
 * 与 S13.3 target_type 白名单同模式：shared schema 不动、路由层 400；AI 提案通道
 * （propose_add_relation）在 tools 层独立拒绝。
 */
function assertHookRelationSourceChapter(project: ProjectContext, sourceType: string, sourceId: string): void {
  if (sourceType !== "outline_node") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `伏笔关系（plants/advances/resolves）的源端须为章大纲节点，当前为 ${sourceType}: ${sourceId}`,
    );
  }
  const node = findOutlineNode(readOutlineFile(project.root), sourceId);
  if (node === undefined || node.deleted === true) return;
  if (node.type !== "chapter") {
    throw new HttpError(400, "VALIDATION_ERROR", `伏笔锚点须为章（卷/场景不承载伏笔标记）: ${sourceId}`);
  }
}

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
 // 伏笔关系源端仅章（卡片 1.3 + 5.2）：plants/advances/resolves 无条件要求源端为章大纲节点
  if ((HOOK_RELATION_TYPES as readonly string[]).includes(relation_type)) {
    assertHookRelationSourceChapter(project, source_type, source_id);
  }
  let row;
  try {
 // occurs_at 1:n 挂载校验（G2，一个事件至多挂一个时间点）。
 // **判重先行语义**：同三元组重复（事件已挂载同一时间点）→ 由 createRelation 判重返回
 // RELATION_EXISTS（与泛型创建语义一致）；事件已挂载**其他**时间点 → 1:n 约束拦截
 // （assertEventSingleOccursAt 抛 EVENT_ALREADY_MOUNTED → 409，跨组改挂载请走 move_to 复合端点）
    if (source_type === "timepoint" && relation_type === "occurs_at" && target_type === "event") {
      const mount = eventOccursAt(project.db, target_id);
      if (mount !== null && mount.source_id !== source_id) {
        assertEventSingleOccursAt(project.db, target_id); // 已挂载其他时间点 → 抛 EVENT_ALREADY_MOUNTED
      }
    }
 // 设定层级校验（2026-08）：belongs_to 且两端均为 setting（子 → 父）——
 // 禁自指 + 防环（新父的祖先链不得含该子设定）。其余 belongs_to（人物→设定）不受影响。
    if (relation_type === "belongs_to" && source_type === "setting" && target_type === "setting") {
      if (source_id === target_id) {
        throw new HttpError(400, "VALIDATION_ERROR", "设定不能作为自己的上级");
      }
      if (wouldCreateSettingCycle(project.db, source_id, target_id)) {
        throw new HttpError(400, "VALIDATION_ERROR", "设定层级不能成环（上级的祖先链包含该设定）");
      }
    }
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

// DELETE /api/v1/relation/:id —— 物理删除（不进回收站）
relationRoutes.delete("/:id", (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const changes = deleteRelation(project.db, id);
  if (changes === 0) {
    throw new HttpError(404, "RELATION_NOT_FOUND", `关系不存在: ${id}`);
  }
  return c.json(ok({ deleted: true as const }));
});

// PUT /api/v1/relation/:id —— 更新关系元数据（「PUT /relation/:id」：
// metadata 整体替换（非浅合并），清空传 {}；三元组不可变——要改连接请删后重建。
// 404 语义：不存在或已软删（软删关系不可编辑）；db 层 null → 404。
// label 首尾 trim（与 POST 创建侧对称；trim 后为空串 → 删除该键，等价清空）
relationRoutes.put("/:id", async (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => null);
  const parsed = relationUpdateMetaReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（metadata 必填、strict 拒绝未知键）
  }
  let metadata = parsed.data.metadata;
  const rawLabel = metadata.label;
  if (typeof rawLabel === "string") {
    const trimmed = rawLabel.trim();
    if (trimmed === "") {
 // 空串标签 → 移除 label 键（等价清空；请求内其余键保留——metadata 整体替换语义）
      metadata = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "label"));
    } else {
      metadata = { ...metadata, label: trimmed };
    }
  }
  const row = updateRelationMetadata(project.db, id, metadata, nowIso());
  if (row === null) {
    throw new HttpError(404, "RELATION_NOT_FOUND", `关系不存在: ${id}`);
  }
  return c.json(ok({ updated: true as const }));
});

/** RelationError → HttpError 映射（文件头注释表） */
export function mapRelationError(err: unknown): never {
  if (err instanceof RelationError) {
    switch (err.code) {
      case "RELATION_EXISTS":
        throw new HttpError(409, "RELATION_EXISTS", err.message);
      case "EVENT_ALREADY_MOUNTED":
 // occurs_at 1:n 重复挂载（G2）——409，与 RELATION_EXISTS 同冲突语义
        throw new HttpError(409, "EVENT_ALREADY_MOUNTED", err.message);
      case "ENDPOINT_NOT_FOUND":
      case "INVALID_RELATION_TYPE":
        throw new HttpError(400, "VALIDATION_ERROR", err.message);
    }
  }
  throw err instanceof Error ? err : new HttpError(500, "INTERNAL_ERROR", "关系操作失败");
}
