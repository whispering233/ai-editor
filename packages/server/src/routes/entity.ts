// 实体路由（S3.3）：GET 列表 / POST 创建 / GET 详情 / PUT 部分更新 / DELETE 软删 / PUT event move（C2，决策 26）
// + PUT timepoint move / POST event move_to（G2，决策 26 修订）
//
// 契约来源：doc/api/endpoints.md 第 124-276 行（实体 CRUD）+ 第 386-393 行（PUT /entity/event/:id/move）、
// 决策 12（软删级联）、决策 26（时间轴事件：全局线性序 sort_order，仅 event 使用）、
// 决策 26 G2 修订（时间标签点实体化：timepoint 全局线性序 + occurs_at 挂载 + 跨组拖拽复合端点）。
// 错误映射（对照 endpoints.md 错误码）：
//   type 参数非法 / 参数校验失败 → 400 VALIDATION_ERROR（zod 抛错由 errorHandler 统一映射，含 fields）
//   实体不存在或已软删 → 404 ENTITY_NOT_FOUND
import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  countDeltasForEntity,
  createEntity,
  createRelation,
  deleteRelation,
  eventOccursAt,
  getEntity,
  listEntities,
  listRelations,
  moveEvent,
  moveSetting,
  moveTimepoint,
  nowIso,
  RelationError,
  softDeleteEntity,
  updateEntity,
  withTransaction,
} from "@whispering233/ai-editor-db";
import type { EntityType } from "@whispering233/ai-editor-shared";
import { sanitizeReferenceFileName } from "@whispering233/ai-editor-shared";
import { ENTITY_DATA_SCHEMAS, entityCreateReqSchema, entityListQuerySchema, entityMoveReqSchema, entityTypeSchema, entityUpdateReqSchema, eventMoveToReqSchema, settingMoveReqSchema } from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";
import {
  getReferenceRow,
  moveReferenceToTrash,
  readReferenceFile,
  REFERENCE_DIR,
  uniqueFileNameIn,
  writeReferenceFile,
} from "../reference-files.js";
import { mapRelationError } from "./relation.js";

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
  const { q, offset, limit, sort, order, tag, parent_id } = parsed.data;
  // 标签筛选（决策 31）：走既有 matchDataFilters.tags 内部管道（S6.3 工具下沉能力挂到 REST）
  const result = listEntities(project.db, {
    type,
    q,
    offset,
    limit,
    sort,
    order,
    filters: tag !== undefined ? { tags: [tag] } : undefined,
    // 空串防御（oracle P2）：`?parent_id=` 空串与「不传 = 不过滤」契约不一致——归一化为 undefined
    parentId: type === "setting" && parent_id !== "" ? parent_id : undefined,
  });
  // M2（2026-08 批次六）：setting 列表附加上级设定（决策 30 层级 = belongs_to）——
  // 补查全量设定间层级边（listRelations 已做软删端点可见性过滤），按 childId 映射附加
  // parentId/parentName（稀疏：无父的设定不出现该字段）；其余类型不附加（契约：仅 setting）
  if (type === "setting") {
    const { relations } = listRelations(
      project.db,
      { sourceType: "setting", targetType: "setting", relationType: "belongs_to" },
      1,
      project.root,
    );
    const parentByChild = new Map<string, { parentId: string; parentName?: string }>();
    for (const r of relations) {
      parentByChild.set(r.sourceId, {
        parentId: r.targetId,
        ...(r.targetName !== undefined ? { parentName: r.targetName } : {}),
      });
    }
    result.items = result.items.map((item) => {
      const parent = parentByChild.get(item.id);
      return parent !== undefined ? { ...item, ...parent } : item;
    });
  }
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
// reference 特例（决策 43）：kind 缺省视为 link（url 必填校验）；kind='file' → 先落盘
// references/<标题 sanitize>.md（frontmatter + 正文）再建索引（data 补 file_name/file_mtime/content 镜像）
entityRoutes.post("/:type", async (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const raw = await c.req.json().catch(() => null);
  const parsed = entityCreateReqSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  if (parsed.data.data !== undefined) {
    validateDataByType(type, parsed.data.data);
  }
  let data = parsed.data.data ?? {};
  if (type === "reference") {
    const kind = data.kind === "file" ? "file" : "link"; // 缺省视为 link（决策 43）
    if (kind === "link") {
      // link 类：url 必填（trim 非空）
      if (typeof data.url !== "string" || data.url.trim() === "") {
        throw new HttpError(400, "VALIDATION_ERROR", "外源链接参考资料必须提供 url");
      }
      data = { ...data, kind: "link", url: data.url.trim() };
    } else {
      // file 类：先原子写文件（frontmatter + 正文镜像），再建索引
      const base = sanitizeReferenceFileName(parsed.data.name);
      const fileName = uniqueFileNameIn(join(project.root, REFERENCE_DIR), base);
      const body = typeof data.content === "string" ? data.content : "";
      const { mtime } = writeReferenceFile(
        project.root,
        fileName,
        { title: parsed.data.name, category: (data.type as string | undefined) ?? "material", tags: Array.isArray(data.tags) ? (data.tags as string[]) : [] },
        body,
      );
      data = {
        ...data,
        kind: "file",
        file_name: fileName,
        file_mtime: mtime,
        content: body,
      };
    }
  }
  const row = createEntity(project.db, { type, name: parsed.data.name, data });
  return c.json(
    ok({ id: row.id, type: row.type, name: row.name, data: row.data, createdAt: row.created_at }),
    201,
  );
});

// PUT /api/v1/entity/:type/:id —— 部分更新（仅合并传入字段；data 浅合并）
// reference file 类特例（决策 43）：**先原子写文件再更新 DB**——正文真相在文件：
//   请求未携带 data.content 时（行内编辑标题/分类/标签）读原文件正文与最新元数据重写 frontmatter 保留正文；
//   文件读失败（外部删除）→ 409 REFERENCE_FILE_MISSING 提示先扫描；文件名不随标题重命名（创建时确定）
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
  let name = parsed.data.name;
  let data = parsed.data.data;
  if (type === "reference") {
    const existing = getReferenceRow(project.db, id);
    if (existing === null) {
      throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`);
    }
    if (existing.data.kind === "file" && typeof existing.data.file_name === "string") {
      const fileName = existing.data.file_name;
      const file = readReferenceFile(project.root, fileName);
      if (file === null) {
        throw new HttpError(409, "REFERENCE_FILE_MISSING", `参考资料文件缺失: references/${fileName}——可能已在文件管理器中被删除，请先扫描同步`);
      }
      // 元数据 = 请求新值 ?? 文件现状 ?? 索引现状；正文 = data.content 传入 ? 新值 : 文件正文
      const nextTitle = name ?? file.title ?? existing.row.name;
      const nextCategory = (data?.type as string | undefined) ?? file.category ?? "material";
      const nextTags = Array.isArray(data?.tags) ? (data.tags as string[]) : file.tags;
      const nextBody = typeof data?.content === "string" ? data.content : file.body;
      const { mtime } = writeReferenceFile(
        project.root,
        fileName,
        { title: nextTitle, category: nextCategory, tags: nextTags, extraLines: file.extraLines },
        nextBody,
      );
      // 服务端维护字段：kind/file_name/file_mtime 不接受客户端覆盖（防御）
      data = {
        ...(data ?? {}),
        kind: "file",
        file_name: fileName,
        file_mtime: mtime,
        content: nextBody,
      };
      name = nextTitle;
    }
  }
  const row = updateEntity(project.db, id, { name, data });
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

// PUT /api/v1/entity/timepoint/:id/move —— 时间轴时间点重排（G2，决策 26 修订，endpoints.md「PUT /entity/timepoint/:id/move」）
// 请求 { order }（0-based 全局时间点线性序；越界 clamp、负数 400 schema 拒绝——语义同 event move）；
// 响应 200 { moved: true }；时间点不存在或已软删 → 404 ENTITY_NOT_FOUND。
// 注意：拖拽时间点**不改其下事件序**（双独立线性序，决策 26 G2 修订）——moveTimepoint 只碰
// timepoint 行，event.sort_order 与 occurs_at 挂载均不动。仅 timepoint 支持（专端点路径）。
entityRoutes.put("/timepoint/:id/move", async (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => null);
  const parsed = entityMoveReqSchema.safeParse(raw); // .strict()：未知键 → 400
  if (!parsed.success) throw parsed.error;
  const result = moveTimepoint(project.db, id, parsed.data.order, nowIso());
  if (result === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `时间点不存在: ${id}`);
  }
  return c.json(ok({ moved: true }));
});

/** move_to 事务内哨兵：moveEvent 返回 null（事件不存在/已软删）→ 抛错回滚事务，路由映射 404 */
class MoveToTargetNotFoundError extends Error {}

// PUT /api/v1/entity/setting/:id/move —— 设定同级重排 / 改父 + 重排（决策 46，2026-08 批次十三，
// 修订决策 42「设定无 sort_order 语义」约束；endpoints.md「PUT /entity/setting/:id/move」）
// 请求 { parent_id: string | null, order?: number }（settingMoveReqSchema，strict）：
//   复合写端点（对齐 G2 event move_to 先例）——改父 + 目标同级组重排一次事务提交：
//   改父 = 事务内建新 belongs_to 边（防环沿用决策 30，违反 → 400 VALIDATION_ERROR）+ 删旧边；
//   重排 = 目标组内 sort_order 重写 0..n-1（NULL 沉底，仅被移行刷 updated_at——决策 14）。
// 响应 200 { moved: true }；设定不存在/已软删 → 404 ENTITY_NOT_FOUND；
// 自指/成环/目标父不存在 → 400 VALIDATION_ERROR（RelationError SETTING_CYCLE/ENDPOINT_NOT_FOUND 映射）。
entityRoutes.put("/setting/:id/move", async (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => null);
  const parsed = settingMoveReqSchema.safeParse(raw); // .strict()：未知键 → 400
  if (!parsed.success) throw parsed.error;
  try {
    const result = moveSetting(
      project.db,
      id,
      { parentId: parsed.data.parent_id, order: parsed.data.order },
      project.root,
    );
    if (result === null) {
      throw new HttpError(404, "ENTITY_NOT_FOUND", `设定不存在: ${id}`);
    }
    return c.json(ok(result));
  } catch (err) {
    // 防环/自指/目标父缺失 → 400（与 POST /relation 的设定层级校验同语义）
    if (err instanceof RelationError) {
      if (err.code === "SETTING_CYCLE" || err.code === "ENDPOINT_NOT_FOUND") {
        throw new HttpError(400, "VALIDATION_ERROR", err.message);
      }
    }
    throw mapRelationError(err);
  }
});

// POST /api/v1/entity/event/:id/move_to —— 事件跨组拖拽复合端点（G2，决策 26 修订，
// endpoints.md「POST /entity/event/:id/move_to」）
// 请求 { timepoint_id: string | null, order: number }（eventMoveToReqSchema）：
//   事务内一次完成（原子，无中间态）——
//   1. 事件存在性先校验（不存在/已软删 → 404，在任何写操作之前）
//   2. 移除事件旧 occurs_at 挂载（物理删——决策 12 修订「手动删关系 = 物理删」，
//      改挂载即重建轻量关系；**同 timepoint 幂等**：目标与旧挂载相同 → 跳过重建，关系 id 不变）
//   3. timepoint_id 非 null 时建立新挂载（createRelation 校验 timepoint 端点存在性，失败 400）
//   4. moveEvent 按 order 重排事件全局线性序（决策 26：组内序 = 全局序投影，跨组后全数组重排）
//   timepoint_id = null → 移出到「未挂载」兜底区（仅重排，不建挂载）。
// 响应 200 { moved: true }；事件不存在/已软删 → 404 ENTITY_NOT_FOUND（事务回滚，旧挂载不丢）；
// timepoint 不存在/已软删 → 400 VALIDATION_ERROR（RelationError ENDPOINT_NOT_FOUND 映射）。
// 决策论证（vs 前端按序调两次 DELETE+POST+move）：非事务分步有中间态风险（拖拽中断/断连残留
// 半挂载状态），复合端点把三步收敛为一次提交——G2 设计「推荐服务端复合写端点」的实现。
entityRoutes.post("/event/:id/move_to", async (c) => {
  const project = requireCurrentProject();
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => null);
  const parsed = eventMoveToReqSchema.safeParse(raw); // .strict()：未知键 → 400
  if (!parsed.success) throw parsed.error;
  try {
    const result = withTransaction(project.db, () => {
      // 1. 事件存在性先校验（不存在/已软删 → null → 404）——**必须在任何写操作之前**，
      //    杜绝「建了新挂载/删了旧挂载却 404」的半状态（moveEvent 的 null 检查在最后，
      //    不能依赖它做首查——createRelation 会在前面以 400 抢先抛出）
      if (getEntity(project.db, id) === null) {
        throw new MoveToTargetNotFoundError();
      }
      // 2. 读当前挂载（未软删 occurs_at；无挂载 → null）
      const oldMount = eventOccursAt(project.db, id);
      // 目标与旧挂载不同（含目标为 null 移出挂载）→ 需要重建挂载；相同 → 幂等跳过（只重排）
      const targetChanged = oldMount === null || oldMount.source_id !== parsed.data.timepoint_id;
      // 3. 改挂载：目标与旧挂载不同（或目标为 null）→ 移除旧挂载（物理删——决策 12 修订
      //    「手动删关系 = 物理删」，改挂载即重建轻量关系）
      if (oldMount !== null && targetChanged) {
        deleteRelation(project.db, oldMount.id);
      }
      // 4. 建新挂载（timepoint_id 非 null 且目标已变；createRelation 校验 timepoint 端点存在性——
      //    不存在/已软删抛 RelationError ENDPOINT_NOT_FOUND → 400；旧挂载已删，不会 RELATION_EXISTS）
      if (parsed.data.timepoint_id !== null && targetChanged) {
        createRelation(
          project.db,
          {
            sourceType: "timepoint",
            sourceId: parsed.data.timepoint_id,
            targetType: "event",
            targetId: id,
            relationType: "occurs_at",
          },
          project.root,
        );
      }
      // 5. 重排全局事件序（事件存在性已在第 1 步校验——moveEvent 返回 null 理论不可达，防御保留）
      const moved = moveEvent(project.db, id, parsed.data.order, nowIso());
      if (moved === null) {
        throw new MoveToTargetNotFoundError();
      }
      return moved;
    });
    return c.json(ok(result));
  } catch (err) {
    if (err instanceof MoveToTargetNotFoundError) {
      throw new HttpError(404, "ENTITY_NOT_FOUND", `事件不存在: ${id}`);
    }
    throw mapRelationError(err); // RelationError（ENDPOINT_NOT_FOUND → 400 / RELATION_EXISTS → 409）
  }
});

// DELETE /api/v1/entity/:type/:id —— 软删（决策 12：级联软删关系与 Delta，本体保留可还原）
// reference file 类特例（决策 43）：先移文件入 references/.trash/（冲突递增命名）再 DB 软删——
// 文件移动失败 → 操作报错（文件未动、索引未删，可重试）；DB 软删失败（罕见）→ 文件在 .trash/ 且
// 索引未软删，scan 反向规则（references/ 下缺失 → 软删）自愈
entityRoutes.delete("/:type/:id", (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const id = c.req.param("id");
  if (type === "reference") {
    const existing = getReferenceRow(project.db, id);
    if (existing === null) {
      throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`);
    }
    if (existing.data.kind === "file" && typeof existing.data.file_name === "string") {
      const fileName = existing.data.file_name;
      // 文件缺失（外部已删）→ 不阻塞软删（索引照删，scan 语义一致）；文件在 → 移入 .trash/
      const full = join(project.root, REFERENCE_DIR, fileName);
      if (existsSync(full)) {
        const trashName = moveReferenceToTrash(project.root, fileName);
        // 冲突递增导致 .trash/ 实际名 ≠ 原 file_name → 更新索引 file_name（软删后仅回收站展示）
        if (trashName !== fileName) {
          updateEntity(project.db, id, { data: { file_name: trashName } });
        }
      }
    }
  }
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
