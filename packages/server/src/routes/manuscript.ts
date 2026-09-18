// 章正文路由（卡 12.4）：GET/PUT /api/v1/manuscript/:chapterNodeId
//
// 契约单一来源：docs/api/110-api-manuscript.md；表与派生口径见 docs/db/schema.md「document_records」。
// 口径：
// - **仅 chapter**——卷/场景 → 400 VALIDATION_ERROR（与 current_position / Delta 锚点 / 伏笔锚点同宽）；
// - 节点不存在或已软删 → 404 OUTLINE_NODE_NOT_FOUND（软删章的行保留，还原后原样可见）；
// - content 浅校验（JSON.parse 后必须是块数组，shared `isBlockArray`）→ 否则 400；
// - `base_updated_at` 仅在携带时比对（不一致 → 409 DOCUMENT_STALE）；省略 = 覆盖保存（导入路径）；
// - `content_text` 由服务端用 shared `blocksToPlainMd` 派生（其内部 try/catch 兜底、绝不抛错 ⇒
//   派生失败也不阻断保存），`charCount = content_text.length`；
// - 保存正文**不产生 Delta、不推进 current_position**（内容不是状态事实）。
import { Hono } from "hono";
import { findOutlineNode, getDocument, readOutlineFile, upsertDocument } from "@whispering233/ai-editor-db";
import type { OutlineFileNode } from "@whispering233/ai-editor-shared";
import { blocksToPlainMd, isBlockArray } from "@whispering233/ai-editor-shared";
import { manuscriptPutReqSchema } from "@whispering233/ai-editor-shared/schemas";
import { nowIso } from "@whispering233/ai-editor-db";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";

/** 章正文路由（挂载于 /api/v1/manuscript，index.ts） */
export const manuscriptRoutes = new Hono();

/** 定位章节点：不存在/已软删 → 404；非章 → 400（正文章级口径，三层同宽） */
function requireChapterNode(project: ProjectContext, nodeId: string): OutlineFileNode {
  const node = findOutlineNode(readOutlineFile(project.root), nodeId);
  if (node === undefined || node.deleted === true) {
    throw new HttpError(404, "OUTLINE_NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  if (node.type !== "chapter") {
    throw new HttpError(400, "VALIDATION_ERROR", `正文只能挂在章节点上: ${nodeId}`);
  }
  return node;
}

/** 浅校验 content：JSON.parse 后必须是块数组（shared `isBlockArray`：非 null 对象数组） */
function parseBlockContent(content: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "content 必须是块数组 JSON 字符串");
  }
  if (!isBlockArray(parsed)) {
    throw new HttpError(400, "VALIDATION_ERROR", "content 必须是块数组 JSON 字符串");
  }
  return parsed;
}

// GET /api/v1/manuscript/:chapterNodeId —— 读取正文（含版本戳；从未写过 = 空文档语义）
manuscriptRoutes.get("/:chapterNodeId", (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("chapterNodeId");
  requireChapterNode(project, nodeId); // 404 / 400 前置（软删章不暴露正文）
  const row = getDocument(project.db, "chapter", nodeId);
  return c.json(
    ok({
      chapterNodeId: nodeId,
      content: row?.content ?? "",
      updatedAt: row?.updated_at ?? null,
      charCount: row?.content_text.length ?? 0,
    }),
  );
});

// PUT /api/v1/manuscript/:chapterNodeId —— 整篇覆盖保存（服务端派生投影 + 版本戳防覆盖）
manuscriptRoutes.put("/:chapterNodeId", async (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("chapterNodeId");
  requireChapterNode(project, nodeId);
  const raw = await c.req.json().catch(() => null);
  const parsed = manuscriptPutReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（content 缺失/非字符串/未知字段）
  }
  const blocks = parseBlockContent(parsed.data.content);
 // 版本戳比对：仅携带 base_updated_at 时校验（库内无行 ⇒ 现有版本戳为 null，传了非空 base 即不一致）
  const existing = getDocument(project.db, "chapter", nodeId);
  const base = parsed.data.base_updated_at;
  if (base !== undefined && (existing?.updated_at ?? null) !== base) {
    throw new HttpError(409, "DOCUMENT_STALE", "正文已被其他窗口修改");
  }
  const contentText = blocksToPlainMd(blocks); // 容错投影（绝不抛错）；失败退化为尽力抽取的文本
  const { updatedAt } = upsertDocument(project.db, {
    ownerKind: "chapter",
    ownerId: nodeId,
    content: parsed.data.content, // 真相原样存（不重新序列化）
    contentText,
    now: nowIso(),
  });
  return c.json(ok({ updated: true as const, updatedAt, charCount: contentText.length }));
});
