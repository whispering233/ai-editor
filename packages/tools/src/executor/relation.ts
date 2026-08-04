// 执行类工具：关系（S6.7，tools.md「执行类」2 个）
// add_relation / remove_relation
//
// - add_relation：端点类型（source_type/target_type）已由 S6.6 提案层派生规范化到 args，
//   此处直接透传 db createRelation（判重 RELATION_EXISTS / 端点存在性校验 db 层负责）；
//   重复确认同一 add_relation 提案 → RELATION_EXISTS 抛错（幂等只保证 hook 复合写，tools.md）
// - remove_relation：手动删关系 = **物理删**（决策 12 修订：不置 deleted_at、不进回收站）；
//   0 行影响（关系不存在）→ 抛错（fail-fast，S7.5 转错误响应）

import { createRelation, deleteRelation } from "@whispering233/ai-editor-db";
import { optionalRecord, requireString, type ExecutorFn } from "./types.js";

/** add_relation（tools.md：add_relation(source, target, type) → id） */
export const executeAddRelation: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const row = createRelation(
    ctx.db,
    {
      sourceType: requireString(args, "source_type"),
      sourceId: requireString(args, "source_id"),
      targetType: requireString(args, "target_type"),
      targetId: requireString(args, "target_id"),
      relationType: requireString(args, "relation_type"),
      metadata: optionalRecord(args, "metadata"),
    },
    ctx.outlineDir,
  );
  return { id: row.id };
};

/** remove_relation（tools.md：remove_relation(id) → void；物理删，决策 12 修订） */
export const executeRemoveRelation: ExecutorFn = (ctx, proposal) => {
  const relationId = requireString(proposal.args, "relation_id");
  const changes = deleteRelation(ctx.db, relationId);
  if (changes === 0) {
    throw new Error(`关系不存在: ${relationId}`);
  }
  return { id: relationId, deleted: true };
};
