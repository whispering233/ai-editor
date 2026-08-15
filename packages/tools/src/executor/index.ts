// executor 门面（S6.7）：executeProposal(ctx, proposal)——提案确认后的执行入口
//
// 按 proposal.type 映射执行函数（PROPOSAL_TOOLS 名 ↔ EXECUTOR_TOOLS 名）：
//   propose_create_entity → create_entity、propose_add_relation → add_relation、
//   propose_advance_hook → advance_hook 等（15 提案 → 13 执行）；
//   propose_create_hook / propose_update_hook 为适配器（hook 即 type=hook 的实体）：
//   - propose_create_hook → create_entity 注入 type="hook" + plant_at_node_id 时
//     同事务补插 plants 关系（提案承诺「确认后建立 plants 关系」，hooks.md 生命周期「埋下」）
//   - propose_update_hook → update_entity（hook_id 即 entity_id，patches 浅合并进 data）
//   propose_reorder_timepoints → reorder_timepoints（G2：批量重排 sort_order，见 executor/reorder-timepoints.ts，
//   取代 F9 的 propose_reorder_events——事件不再带 time_label，语义序载体变为时间点实体）
//
// **不注册 registry**：执行类是用户确认后由本门面调用的底层写路径，**不暴露给 LLM**
// （tools.md「核心设计原则」——AI 不可以调用执行类工具）。
// 映射表类型安全：key 为 15 个提案类型字面量联合（Record 缺键编译期报错）；
// 运行时未知 type → 查表 undefined → 抛错（防静默，S7.5 转错误响应）。
// signal：执行类是短同步事务，不做中止检查（决策 16 ③ 只要求长工具执行中检查；
// S7.5 确认路由在调用前做取消判定）。

import { createEntity, createRelation, withTransaction } from "@whispering233/ai-editor-db";
import { EXECUTOR_TOOLS, PROPOSAL_TOOLS } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { requireHook, requireOutlineNode } from "../proposal/types.js";
import type { Proposal } from "../proposal/types.js";
import { executeAddDelta } from "./delta.js";
import { executeCreateEntity, executeDeleteEntity, executeUpdateEntity } from "./entity.js";
import { executeAddRelation, executeRemoveRelation } from "./relation.js";
import { executeCreateOutlineNode, executeDeleteNode, executeMoveNode } from "./outline.js";
import { executeAbandonHook, executeAdvanceHook, executeResolveHook } from "./hook.js";
import { executeReorderTimepoints } from "./reorder-timepoints.js";
import { optionalRecord, requireString, type ExecutorFn, type ExecutorResult } from "./types.js";

/** 提案类型字面量联合（15 个，PROPOSAL_TOOLS 常量派生——注册表/门面共用契约） */
export type ProposalType = (typeof PROPOSAL_TOOLS)[number];

/** 执行工具名字面量联合（13 个，EXECUTOR_TOOLS 常量派生） */
export type ExecutorToolName = (typeof EXECUTOR_TOOLS)[number];

/** 适配 propose_create_hook → 复合建 hook：create_entity(type=hook) + plants 关系一次提交 */
const executeCreateHook: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const name = requireString(args, "name");
  const data = optionalRecord(args, "data");
  const plantAtNodeId = args.plant_at_node_id === undefined ? undefined : requireString(args, "plant_at_node_id");
  return withTransaction(ctx.db, () => {
    const row = createEntity(ctx.db, { type: "hook", name, data });
    if (plantAtNodeId !== undefined) {
      requireOutlineNode(ctx, plantAtNodeId); // 埋设节点存在且未软删（决策 12；createRelation 亦校验）
      createRelation(
        ctx.db,
        { sourceType: "outline_node", sourceId: plantAtNodeId, targetType: "hook", targetId: row.id, relationType: "plants" },
        ctx.outlineDir,
      );
    }
    return { id: row.id };
  });
};

/** 适配 propose_update_hook → update_entity：hook_id 即 entity_id（hook 是实体的一种） */
const executeUpdateHook: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const hookId = requireString(args, "hook_id");
  // 复核实体类型（S6.7 修复轮建议 4）：委托 update_entity 前再 requireHook 一次——
  // 防御纵深，与 create_hook 适配器同风格（提案层 zod 已校验，此处防类型漂移/绕过）
  requireHook(ctx, hookId);
  return executeUpdateEntity(ctx, { ...proposal, args: { entity_id: hookId, patches: args.patches } });
};

/**
 * 提案类型 → 执行函数映射表（S6.7 门面核心）。
 * 类型安全：key 为 ProposalType 字面量联合，缺映射编译期报错；values 均为
 * (ctx, proposal) → ExecutorResult 的执行函数/适配器。
 */
const EXECUTE_BY_PROPOSAL_TYPE: Record<ProposalType, ExecutorFn> = {
  propose_create_entity: executeCreateEntity,
  propose_update_entity: executeUpdateEntity,
  propose_delete_entity: executeDeleteEntity,
  propose_add_relation: executeAddRelation,
  propose_remove_relation: executeRemoveRelation,
  propose_add_delta: executeAddDelta,
  propose_outline_node: executeCreateOutlineNode,
  propose_move_node: executeMoveNode,
  propose_delete_node: executeDeleteNode,
  propose_create_hook: executeCreateHook,
  propose_update_hook: executeUpdateHook,
  propose_advance_hook: executeAdvanceHook,
  propose_resolve_hook: executeResolveHook,
  propose_abandon_hook: executeAbandonHook,
  propose_reorder_timepoints: executeReorderTimepoints, // G2：批量重排 sort_order（取代 F9 的 propose_reorder_events）
};

/**
 * 执行提案（S7.5 确认后调用）：按 proposal.type 映射执行函数，args 透传（S6.6 已规范化
 * 为执行形态），返回执行结果（如新 id）。未知/缺失映射抛错（防静默——不该出现的
 * 提案类型说明上层调度 bug）。
 */
export function executeProposal(ctx: ToolContext, proposal: Proposal): ExecutorResult {
  const fn = EXECUTE_BY_PROPOSAL_TYPE[proposal.type as ProposalType];
  if (fn === undefined) {
    throw new Error(`executeProposal: 未知提案类型 ${proposal.type}`);
  }
  return fn(ctx, proposal);
}

// 执行工具名常量再导出（S7.5 校验/日志用；不注册 registry——见文件头注释）
export type { ExecutorFn, ExecutorResult } from "./types.js";
export { executeCreateEntity, executeUpdateEntity, executeDeleteEntity } from "./entity.js";
export { executeAddRelation, executeRemoveRelation } from "./relation.js";
export { executeAddDelta } from "./delta.js";
export { executeCreateOutlineNode, executeMoveNode, executeDeleteNode } from "./outline.js";
export { executeAdvanceHook, executeResolveHook, executeAbandonHook } from "./hook.js";
export { executeReorderTimepoints } from "./reorder-timepoints.js";
export { EXECUTOR_TOOLS };
