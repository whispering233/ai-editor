// 文风仿写练习路由（卡 5）：/api/v1/practice/*
//
// 契约：`docs/api/120-api-practice.md`（九个端点的 Req/Res 形状与语义）、
// `docs/api/error-code.md`（`KIND_MISMATCH` 400 / `PRACTICE_NOT_FOUND` 404）；
// 数据与不变式见 `docs/design/60-practice.md` §3、`docs/db/schema.md`「practice_targets / practice_samples」。
//
// 分工（**库写入唯一入口 = db 包 `queries/practice.ts`，本层不碰表**）：
// - 请求 schema 单一来源 = shared `types/api.ts`（本层只 parse 请求；响应 schema 是类型契约，
//   响应由本层按文档逐字段拼出）；schema 全 `.strict()` ⇒ camelCase 字段名与多余字段一律被拒
// - **长度上限校验落本层**（db 层有意不校验）：由 shared schema 消费 shared 常量完成，
//   超限 → 400 `VALIDATION_ERROR`
// - 路由层组装三件（db 层不做，卡 5 承接事实）：① `PUT /practice/targets/:id` 响应含 `sampleCount`；
//   ② 详情（含新建样本的响应）拼 `targetName` + `observation`；③ 不存在 → 404 `PRACTICE_NOT_FOUND`
//
// 反向守卫（`requireKind("practice")`，小说工作区访问 → 400 `KIND_MISMATCH`）的挂载点**只在
// `index.ts`**，且必须在本组 `app.route` 之前（Hono 按注册序组合中间件与 handler）。
import { Hono, type Context } from "hono";
import {
  createPracticeSample,
  createPracticeTarget,
  deletePracticeSample,
  deletePracticeTarget,
  getPracticeSample,
  getPracticeTarget,
  listPracticeSamples,
  listPracticeTargets,
  updatePracticeDraft,
  updatePracticeTarget,
  type Db,
  type PracticeSampleRow,
  type PracticeTargetRow,
} from "@whispering233/ai-editor-db";
import type { PracticeFeedbackCard, PracticeSampleDetail, PracticeTargetItem } from "@whispering233/ai-editor-shared";
import {
  practiceSampleCreateReqSchema,
  practiceSampleDraftPutReqSchema,
  practiceTargetCreateReqSchema,
  practiceTargetUpdateReqSchema,
} from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";

/** 练习路由（挂载于 /api/v1/practice，index.ts） */
export const practiceRoutes = new Hono();

/** 目标不存在（改 / 删目标、列 / 建该目标下的样本）→ 404 `PRACTICE_NOT_FOUND` */
function targetNotFound(): HttpError {
  return new HttpError(404, "PRACTICE_NOT_FOUND", "文风目标不存在");
}

/** 样本不存在（详情 / 保存稿件 / 删除）→ 404 `PRACTICE_NOT_FOUND` */
function sampleNotFound(): HttpError {
  return new HttpError(404, "PRACTICE_NOT_FOUND", "练习样本不存在");
}

/** 请求体解析：空 body / 非法 JSON → null，统一交给 schema 报校验失败（同 names.ts 口径） */
async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

/**
 * 目标行的单项目投影（camelCase）：**含 `sampleCount`**——`PUT /practice/targets/:id` 的响应形状
 * 与列表项同形（承接事实①），而 db helper 返回存储形态（snake_case、无计数）⇒ 本层拼。
 */
function toTargetItem(row: PracticeTargetRow, sampleCount: number): PracticeTargetItem {
  return {
    id: row.id,
    name: row.name,
    observation: row.observation,
    sampleCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 该目标下的样本数：复用样本列表投影的长度（不引入第二套计数口径） */
function countSamples(db: Db, targetId: string): number {
  return listPracticeSamples(db, targetId)?.length ?? 0;
}

/**
 * 样本详情的 API 投影：**拼目标名与观察**（承接事实②，db 层不拼）——详情与新建样本的响应共用一个形状
 * （新建时 `draft` = ""、`feedback` = null，由 db helper 保证）。
 * `feedback` 只透传：写入侧唯一入口是提交点评工具（卡 6），读取侧的坏 JSON 防御解析在 db 层
 * （非对象 → null）——本层不重复校验、也不做键名转换。
 */
function toSampleDetail(db: Db, row: PracticeSampleRow): PracticeSampleDetail {
  const target = getPracticeTarget(db, row.target_id);
  if (target === null) {
    // 级联删应已带走样本；目标缺失 = 外部直接改库，按不存在处理（不编造空目标名）
    throw targetNotFound();
  }
  return {
    id: row.id,
    targetId: row.target_id,
    targetName: target.name,
    observation: target.observation,
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    text: row.text,
    draft: row.draft,
    feedback: row.feedback as PracticeFeedbackCard | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/v1/practice/targets —— 文风目标列表（按 updatedAt 倒序）
practiceRoutes.get("/targets", (c) => {
  const project = requireCurrentProject();
  return c.json(ok({ targets: listPracticeTargets(project.db) }));
});

// POST /api/v1/practice/targets —— 新建文风目标
practiceRoutes.post("/targets", async (c) => {
  const project = requireCurrentProject();
  const parsed = practiceTargetCreateReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error; // → 400 VALIDATION_ERROR（含 fields）
  const row = createPracticeTarget(project.db, {
    name: parsed.data.name,
    observation: parsed.data.observation,
  });
  // 新建目标的响应不含 sampleCount（对照文档 POST 的 Res 形状）
  return c.json(
    ok({
      id: row.id,
      name: row.name,
      observation: row.observation,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
});

// PUT /api/v1/practice/targets/:id —— 改名 / 改观察（部分更新；observation 空串 = 清空）
practiceRoutes.put("/targets/:id", async (c) => {
  const project = requireCurrentProject();
  const parsed = practiceTargetUpdateReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error;
  const updated = updatePracticeTarget(project.db, c.req.param("id"), {
    name: parsed.data.name,
    observation: parsed.data.observation,
  });
  if (updated === null) throw targetNotFound();
  return c.json(ok(toTargetItem(updated, countSamples(project.db, updated.id))));
});

// DELETE /api/v1/practice/targets/:id —— 删除目标（物理删 + 级联删其全部样本）
practiceRoutes.delete("/targets/:id", (c) => {
  const project = requireCurrentProject();
  const result = deletePracticeTarget(project.db, c.req.param("id"));
  if (result === null) throw targetNotFound();
  return c.json(ok(result));
});

// GET /api/v1/practice/targets/:id/samples —— 某目标下的样本列表（按 updatedAt 倒序）
practiceRoutes.get("/targets/:id/samples", (c) => {
  const project = requireCurrentProject();
  const samples = listPracticeSamples(project.db, c.req.param("id"));
  if (samples === null) throw targetNotFound();
  return c.json(ok({ samples }));
});

// POST /api/v1/practice/targets/:id/samples —— 新建练习样本（粘贴范文）
practiceRoutes.post("/targets/:id/samples", async (c) => {
  const project = requireCurrentProject();
  const parsed = practiceSampleCreateReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error;
  const row = createPracticeSample(project.db, {
    targetId: c.req.param("id"),
    sourceLabel: parsed.data.source_label,
    text: parsed.data.text,
    sourceKind: parsed.data.source_kind,
  });
  if (row === null) throw targetNotFound();
  return c.json(ok(toSampleDetail(project.db, row)));
});

// GET /api/v1/practice/samples/:id —— 样本详情（唯一返回范文全文与点评卡的读端点）
practiceRoutes.get("/samples/:id", (c) => {
  const project = requireCurrentProject();
  const row = getPracticeSample(project.db, c.req.param("id"));
  if (row === null) throw sampleNotFound();
  return c.json(ok(toSampleDetail(project.db, row)));
});

// PUT /api/v1/practice/samples/:id —— 保存仿写稿（strict 单字段；全系统唯一的用户写稿入口）
practiceRoutes.put("/samples/:id", async (c) => {
  const project = requireCurrentProject();
  const parsed = practiceSampleDraftPutReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error;
  const result = updatePracticeDraft(project.db, c.req.param("id"), parsed.data.draft);
  if (result === null) throw sampleNotFound();
  return c.json(ok(result));
});

// DELETE /api/v1/practice/samples/:id —— 删除样本（物理删）
practiceRoutes.delete("/samples/:id", (c) => {
  const project = requireCurrentProject();
  if (!deletePracticeSample(project.db, c.req.param("id"))) throw sampleNotFound();
  return c.json(ok({ deleted: true }));
});
