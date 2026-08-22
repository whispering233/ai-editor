// 名称解析路由（决策 47，批次十四）：POST /api/v1/names/resolve
// 契约来源：doc/api/endpoints.md「POST /api/v1/names/resolve」节
// 用途：把工具调用参数中的 id 解析为人类可读名称（label = 类型中文，name = 实体名/节点标题），
//   供前端渲染摘要行（不暴露裸 id）。解析收敛服务端单点——按 id 前缀分流查库。
// 前缀分流（id 约定见 endpoints.md「id 约定」）：
//   char-/set-/loc-/hook-/ev-/tp-/ref- → entities 表（getEntity 已过滤软删）
//   vol-/ch-/sc- → outline.json 节点（findOutlineNode 读侧不过滤软删——deleted: true 返回 null）
//   rel- → null（关系无名称语义，决策 47）
//   其余前缀（proj-/prop_/sess_/call_/未知）→ null
// 响应 names 键集 = 请求 ids 去重后全集（每个 id 必有条目，未命中 = null）
import { Hono } from "hono";
import { getEntity, findOutlineNode, readOutlineFile } from "@whispering233/ai-editor-db";
import { ENTITY_TYPE_LABELS, OUTLINE_NODE_TYPE_LABELS } from "@whispering233/ai-editor-shared";
import { namesResolveReqSchema } from "@whispering233/ai-editor-shared/schemas";
import type { OutlineFileNode } from "@whispering233/ai-editor-shared";
import { ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";

/** 名称解析路由（挂载于 /api/v1/names，index.ts） */
export const namesRoutes = new Hono();

/** 实体 id 前缀（char-/set-/loc-/hook-/ev-/tp-/ref-，ENTITY_ID_PREFIX 同源） */
const ENTITY_PREFIXES = ["char-", "set-", "loc-", "hook-", "ev-", "tp-", "ref-"] as const;

/** 大纲节点 id 前缀（vol-/ch-/sc-） */
const OUTLINE_PREFIXES = ["vol-", "ch-", "sc-"] as const;

/** 解析单个 id：未命中/未知前缀 → null */
function resolveOne(id: string, project: ProjectContext): { label: string; name: string } | null {
  // 实体前缀分流（getEntity 过滤已软删行，软删 → null）
  for (const prefix of ENTITY_PREFIXES) {
    if (id.startsWith(prefix)) {
      const row = getEntity(project.db, id);
      return row === null ? null : { label: ENTITY_TYPE_LABELS[row.type], name: row.name };
    }
  }
  // 大纲节点前缀分流（findOutlineNode 读侧不过滤软删——deleted: true 视为不存在）
  for (const prefix of OUTLINE_PREFIXES) {
    if (id.startsWith(prefix)) {
      const tree = readOutlineFile(project.root);
      const node = findOutlineNode(tree, id) as OutlineFileNode | undefined;
      if (node === undefined || node.deleted === true) return null;
      return { label: OUTLINE_NODE_TYPE_LABELS[node.type], name: node.title };
    }
  }
  // rel- 与其他前缀（proj-/prop_/sess_/call_/未知）：无名称语义 → null
  return null;
}

// POST /api/v1/names/resolve —— 批量名称解析
namesRoutes.post("/resolve", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
  const parsed = namesResolveReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  }
  // 去重（保持请求顺序）——重复 id 只解析一次
  const uniqueIds = [...new Set(parsed.data.ids)];
  const names: Record<string, { label: string; name: string } | null> = {};
  for (const id of uniqueIds) {
    names[id] = resolveOne(id, project);
  }
  return c.json(ok({ names }));
});
