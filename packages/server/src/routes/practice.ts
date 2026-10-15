// 作家文风练习路由（/api/v1/practice/*，2026-10 改版）——13 个端点
//
// 契约：`docs/api/120-api-practice.md`（13 个端点的 Req/Res 形状与语义）、
// `docs/api/error-code.md`（`KIND_MISMATCH` 400 / `VALIDATION_ERROR` 400 / `PRACTICE_NOT_FOUND` 404）；
// 设计与不变式见 `docs/design/60-practice.md` §2 / §5 / §6。
//
// 分工（**库写入唯一入口 = db 包 `queries/practice.ts`，本层不碰表**）：
// - 请求 schema 单一来源 = shared `types/api.ts`（本层只 parse 请求；**响应 schema 是类型契约，
//   响应不 `.parse()`**——由本层按文档逐字段拼出）；schema 全 `.strict()` ⇒ 多余字段被拒
// - **长度上限校验落 shared schema**（db 层有意不校验）：超限 → 400 `VALIDATION_ERROR`
// - 本层另做两件 db 层不做的校验：① `work_id` 成员校验（shared `resolveWork`）；
//   ② 不存在 → 404 `PRACTICE_NOT_FOUND`（**文案按资源**：样本「练习样本不存在」、自由练习「自由练习不存在」）
//
// 前置守卫（单点函数 `requirePracticeWorkspace`，本组全部端点共用）：
// ① `kind ≠ "practice"` → 400 `KIND_MISMATCH`（文案与服务端 `requireKind` 同源，见 middleware/kind.ts；
//    整组中间件 `requireKind("practice")` 另挂在 index.ts，本函数是端点级同口径兜底，不改错误语义）；
// ② `author_id` 解析不到预置作家 → 400 `VALIDATION_ERROR`「练习工作区未关联预置作家」（存量 / 坏值工作区）。
import { Hono, type Context } from "hono";
import {
  createPracticePiece,
  createPracticeSample,
  deletePracticePiece,
  deletePracticeSample,
  deleteStylePack,
  getPracticePiece,
  getPracticeSample,
  getStylePack,
  listPracticePieces,
  listPracticeSamples,
  updatePracticePieceDraft,
  updatePracticeSampleDraft,
  upsertStylePack,
  type PracticePieceRow,
  type PracticeSampleRow,
  type PracticeStylePackRow,
} from "@whispering233/ai-editor-db";
import type {
  PracticeFeedbackCard,
  PracticePieceDetail,
  PracticeSampleDetail,
  PracticeStylePack,
} from "@whispering233/ai-editor-shared";
import { resolveAuthor, resolveWork, type AuthorEntry } from "@whispering233/ai-editor-shared";
import {
  practiceDraftPutReqSchema,
  practicePieceCreateReqSchema,
  practiceSampleCreateReqSchema,
  practiceStylePackPutReqSchema,
} from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { assertWorkspaceKind } from "../middleware/kind.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";

/** 练习路由（挂载于 /api/v1/practice，index.ts） */
export const practiceRoutes = new Hono();

/** 样本不存在（详情 / 保存稿件 / 删除）→ 404 `PRACTICE_NOT_FOUND` */
function sampleNotFound(): HttpError {
  return new HttpError(404, "PRACTICE_NOT_FOUND", "练习样本不存在");
}

/** 自由练习篇不存在（详情 / 保存稿件 / 删除）→ 404 `PRACTICE_NOT_FOUND` */
function pieceNotFound(): HttpError {
  return new HttpError(404, "PRACTICE_NOT_FOUND", "自由练习不存在");
}

/**
 * 前置守卫（本组端点共用的**单点**）：当前工作区必须 `kind = "practice"` 且 `author_id` 能解析到
 * 预置作家（shared `AUTHOR_CATALOG`）；无当前工作区 → 409 `NO_PROJECT_OPEN`（`requireCurrentProject`）。
 * 返回已解析的作家条目，供素材包端点取预置风格说明（不重复解析）。
 */
function requirePracticeWorkspace(): { project: ProjectContext; author: AuthorEntry } {
  const project = requireCurrentProject();
  assertWorkspaceKind(project, "practice");
  const author = resolveAuthor(project.config.author_id);
  if (author === null) {
    throw new HttpError(400, "VALIDATION_ERROR", "练习工作区未关联预置作家");
  }
  return { project, author };
}

/** 请求体解析：空 body / 非法 JSON → null，统一交给 schema 报校验失败（同 names.ts 口径） */
async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

/**
 * 样本详情的 API 投影（详情与新建样本的响应共用同一形状）。
 * `feedback` 只透传：写入侧唯一入口是提交点评工具，读取侧的坏 JSON 防御解析在 db 层
 * （**非对象** → null，合法 JSON 对象一律透传）——本层不重复校验、也不做键名转换。
 */
function toSampleDetail(row: PracticeSampleRow): PracticeSampleDetail {
  return {
    id: row.id,
    workId: row.work_id,
    excerptLabel: row.excerpt_label,
    text: row.text,
    draft: row.draft,
    feedback: row.feedback as PracticeFeedbackCard | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 自由练习详情的 API 投影（详情与新建的响应共用同一形状） */
function toPieceDetail(row: PracticePieceRow): PracticePieceDetail {
  return {
    id: row.id,
    topic: row.topic,
    brief: row.brief,
    topicSource: row.topic_source,
    draft: row.draft,
    feedback: row.feedback as PracticeFeedbackCard | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============ 范文样本（五端点） ============

// GET /api/v1/practice/samples —— 本工作区全部样本（按 updatedAt 倒序；列表不回正文与卡体）
practiceRoutes.get("/samples", (c) => {
  const { project } = requirePracticeWorkspace();
  return c.json(ok({ samples: listPracticeSamples(project.db) }));
});

// POST /api/v1/practice/samples —— 新建样本（粘贴或导入文本均走这里）
practiceRoutes.post("/samples", async (c) => {
  const { project, author } = requirePracticeWorkspace();
  const parsed = practiceSampleCreateReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error; // → 400 VALIDATION_ERROR（含 fields）
  const workId = parsed.data.work_id ?? null;
  // work_id 成员校验：给了就必须在预置作品清单内（未知 id 不静默落成「其他」——那会让用户以为选上了）
  if (workId !== null && resolveWork(author.id, workId) === null) {
    throw new HttpError(400, "VALIDATION_ERROR", `未知的作品 id: ${workId}（须为预置作品清单内的 id）`);
  }
  const row = createPracticeSample(project.db, {
    workId,
    excerptLabel: parsed.data.excerpt_label,
    text: parsed.data.text,
  });
  return c.json(ok(toSampleDetail(row)));
});

// GET /api/v1/practice/samples/:id —— 样本详情（唯一返回范文全文与点评卡的读端点）
practiceRoutes.get("/samples/:id", (c) => {
  const { project } = requirePracticeWorkspace();
  const row = getPracticeSample(project.db, c.req.param("id"));
  if (row === null) throw sampleNotFound();
  return c.json(ok(toSampleDetail(row)));
});

// PUT /api/v1/practice/samples/:id —— 保存仿写稿（strict 单字段；唯一的用户写稿入口，后写覆盖）
practiceRoutes.put("/samples/:id", async (c) => {
  const { project } = requirePracticeWorkspace();
  const parsed = practiceDraftPutReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error;
  const result = updatePracticeSampleDraft(project.db, c.req.param("id"), parsed.data.draft);
  if (result === null) throw sampleNotFound();
  return c.json(ok(result));
});

// DELETE /api/v1/practice/samples/:id —— 删除样本（物理删）
practiceRoutes.delete("/samples/:id", (c) => {
  const { project } = requirePracticeWorkspace();
  if (!deletePracticeSample(project.db, c.req.param("id"))) throw sampleNotFound();
  return c.json(ok({ deleted: true as const }));
});

// ============ 作家风格说明素材包（三端点） ============
//
// 预置文本 = shared 常量（无端点）；这里读写的是当前工作区作者的**用户覆盖**（单行）。

/** 生效内容 = 用户覆盖 `??` 预置（无覆盖 → 预置，恒非空） */
function toStylePack(author: AuthorEntry, override: PracticeStylePackRow | null): PracticeStylePack {
  return {
    authorId: author.id,
    content: override?.content ?? author.styleNotes,
    customized: override !== null,
    updatedAt: override?.updated_at ?? null,
  };
}

// GET /api/v1/practice/style-pack —— 生效内容 + 是否有用户覆盖
practiceRoutes.get("/style-pack", (c) => {
  const { project, author } = requirePracticeWorkspace();
  return c.json(ok(toStylePack(author, getStylePack(project.db, author.id))));
});

// PUT /api/v1/practice/style-pack —— 写入用户覆盖（trim 非空；清空请用 DELETE）
practiceRoutes.put("/style-pack", async (c) => {
  const { project, author } = requirePracticeWorkspace();
  const parsed = practiceStylePackPutReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error;
  return c.json(ok(toStylePack(author, upsertStylePack(project.db, author.id, parsed.data.content))));
});

// DELETE /api/v1/practice/style-pack —— 删除用户覆盖 = 恢复预置（幂等：无覆盖也 200）
practiceRoutes.delete("/style-pack", (c) => {
  const { project, author } = requirePracticeWorkspace();
  deleteStylePack(project.db, author.id);
  return c.json(ok(toStylePack(author, null)));
});

// ============ 自由练习（五端点） ============

// GET /api/v1/practice/free —— 本工作区全部自由练习篇（按 updatedAt 倒序；列表不回稿件与卡体）
practiceRoutes.get("/free", (c) => {
  const { project } = requirePracticeWorkspace();
  return c.json(ok({ pieces: listPracticePieces(project.db) }));
});

// POST /api/v1/practice/free —— 新建自由练习篇（自拟题，或建「待出题」空题行）
practiceRoutes.post("/free", async (c) => {
  const { project } = requirePracticeWorkspace();
  const parsed = practicePieceCreateReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error; // topic 与 topic_source 的一致性在 schema（superRefine）
  const row = createPracticePiece(project.db, {
    topicSource: parsed.data.topic_source,
    topic: parsed.data.topic,
    brief: parsed.data.brief,
  });
  return c.json(ok(toPieceDetail(row)));
});

// GET /api/v1/practice/free/:id —— 自由练习详情（唯一返回稿件全文与点评卡的读端点）
practiceRoutes.get("/free/:id", (c) => {
  const { project } = requirePracticeWorkspace();
  const row = getPracticePiece(project.db, c.req.param("id"));
  if (row === null) throw pieceNotFound();
  return c.json(ok(toPieceDetail(row)));
});

// PUT /api/v1/practice/free/:id —— 保存自由练习稿（与仿写稿同一口径：strict 单字段、允许空串、后写覆盖）
practiceRoutes.put("/free/:id", async (c) => {
  const { project } = requirePracticeWorkspace();
  const parsed = practiceDraftPutReqSchema.safeParse(await readJson(c));
  if (!parsed.success) throw parsed.error;
  const result = updatePracticePieceDraft(project.db, c.req.param("id"), parsed.data.draft);
  if (result === null) throw pieceNotFound();
  return c.json(ok(result));
});

// DELETE /api/v1/practice/free/:id —— 删除自由练习篇（物理删；不满意的 AI 出题 = 删掉重建）
practiceRoutes.delete("/free/:id", (c) => {
  const { project } = requirePracticeWorkspace();
  if (!deletePracticePiece(project.db, c.req.param("id"))) throw pieceNotFound();
  return c.json(ok({ deleted: true as const }));
});