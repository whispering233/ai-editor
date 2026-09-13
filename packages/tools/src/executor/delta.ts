// 执行类工具：Delta（S6.7，「执行类」1 个）
// add_delta
//
// - node_id / target_type / target_id / changes 已由 S6.6 提案层派生规范化到 args
// - **锚点仅章（卡片 1.5）**：node_id 经 requireChapterNode 校验（存在 + 未软删 + chapter）——
// executor 直写 db **绕过 REST 校验**，而卡 1.4 后非章锚点的 Delta **静默不参与累积**
// （「写了但永远不算」，比报错更难排查）；与 REST（server/routes/delta.ts）/ 提案层同口径
// - **事实字段兜底（卡片 5.4）**：经 `assertFactFieldsSetOnly` 拒非 `set` 的 hook.status 变更——
// 与锚点兜底同模式（同一事务内、校验先于写入）：executor 直写 db 也绕过提案层守卫，
// 而该字段用 `update`+`from` 重放必然产生假 conflicts（详见 `docs/design/10-data-model.md` §4）
// - description（delta_records NOT NULL）：取 **proposal.summary** 作人类可读描述
// （S6.6 delta.ts 注释：由执行器取 summary——args 不带 description，提案摘要即变更描述）
// - order 由 db 层全局单调生成（insertDelta 事务内 MAX+1），此处无 order 入参

import { insertDelta } from "@whispering233/ai-editor-db";
import type { DeltaChange } from "@whispering233/ai-editor-shared";
import { assertFactFieldsSetOnly } from "../proposal/delta.js";
import { requireChapterNode } from "../proposal/types.js";
import { requireArray, requireString, type ExecutorFn } from "./types.js";

/** add_delta（add_delta(node_id, target, changes) → id） */
export const executeAddDelta: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const nodeId = requireString(args, "node_id");
  const targetType = requireString(args, "target_type");
  const changes = requireArray(args, "changes") as DeltaChange[]; // 提案层 schema 已校验 deltaChangeSchema
 // 章级兜底：节点存在且未软删 + type === "chapter"（卷/场景拒绝）
  requireChapterNode(ctx, nodeId, "变更记录锚点");
 // 事实字段兜底（卡片 5.4）：与提案层共用同一白名单与文案（executor 直写 db 绕过提案层）
  assertFactFieldsSetOnly(targetType, changes);
  const row = insertDelta(ctx.db, {
    nodeId,
    targetType,
    targetId: requireString(args, "target_id"),
    changes,
    description: proposal.summary,
  });
  return { id: row.id };
};
