// 执行类工具：Delta（S6.7，tools.md「执行类」1 个）
// add_delta
//
// - node_id / target_type / target_id / changes 已由 S6.6 提案层派生规范化到 args
// - description（delta_records NOT NULL）：取 **proposal.summary** 作人类可读描述
//   （S6.6 delta.ts 注释：由执行器取 summary——args 不带 description，提案摘要即变更描述）
// - order 由 db 层全局单调生成（insertDelta 事务内 MAX+1），此处无 order 入参

import { insertDelta } from "@ai-editor/db";
import type { DeltaChange } from "@ai-editor/shared";
import { requireArray, requireString, type ExecutorFn } from "./types.js";

/** add_delta（tools.md：add_delta(node_id, target, changes) → id） */
export const executeAddDelta: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const row = insertDelta(ctx.db, {
    nodeId: requireString(args, "node_id"),
    targetType: requireString(args, "target_type"),
    targetId: requireString(args, "target_id"),
    changes: requireArray(args, "changes") as DeltaChange[], // 提案层 schema 已校验 deltaChangeSchema
    description: proposal.summary,
  });
  return { id: row.id };
};
