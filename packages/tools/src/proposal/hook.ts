// 提案类工具：伏笔（S6.6，hooks.md「工具扩展」提案类 5 个）
// propose_create_hook / propose_update_hook / propose_advance_hook /
// propose_resolve_hook / propose_abandon_hook
//
// 语义：只产出提案对象并返回 { proposal_id, summary }（2026-08 修订：tool_result 不含预览）；
// **不落盘、不写任何数据**（与 S6.7 advance_hook/resolve_hook/abandon_hook 复合写对比的核心差异）。
//
// 生成时校验（决策 14/19/12）：
// - 伏笔即 type=hook 的实体（hooks.md：用户手动创建或 AI 提案创建）——requireHook 校验
//   存在、未软删且类型一致，采集实体自身 updated_at 快照（决策 14）
// - 推进/回收的节点（node_id）与埋设节点（plant_at_node_id）存在且未软删——
//   节点级 updated_at 快照（决策 19）
// - 确认后的复合写（delta_records 记 status + relation_records 插 advances/resolves，
//   一次提交、幂等）由 S6.7 执行工具承担，本模块只产出提案

import type {
  ProposeAbandonHookArgs,
  ProposeAdvanceHookArgs,
  ProposeCreateHookArgs,
  ProposeResolveHookArgs,
  ProposeUpdateHookArgs,
} from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refEntity, refOutlineNode, requireHook, requireOutlineNode, type Proposal, type ProposalReference, type ToolProposalResult } from "./types.js";

/** 产出创建伏笔提案（plant_at_node_id 可选指定埋设节点） */
export function buildProposeCreateHook(ctx: ToolContext, args: ProposeCreateHookArgs): Proposal {
  const references: ProposalReference[] = [];
  if (args.plant_at_node_id !== undefined) {
    references.push(refOutlineNode(requireOutlineNode(ctx, args.plant_at_node_id)));
  }
  return buildProposal(
    ctx,
    "propose_create_hook",
    {
      name: args.name,
      ...(args.data === undefined ? {} : { data: args.data }),
      ...(args.plant_at_node_id === undefined ? {} : { plant_at_node_id: args.plant_at_node_id }),
    },
    references,
    `创建伏笔「${args.name}」`,
  );
}

/** propose_create_hook run */
export function runProposeCreateHook(
  ctx: ToolContext,
  args: ProposeCreateHookArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeCreateHook(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出更新伏笔提案（引用伏笔实体 updated_at 快照，决策 14） */
export function buildProposeUpdateHook(ctx: ToolContext, args: ProposeUpdateHookArgs): Proposal {
  const hook = requireHook(ctx, args.hook_id);
  const fieldCount = Object.keys(args.patches).length;
  return buildProposal(
    ctx,
    "propose_update_hook",
    { hook_id: args.hook_id, patches: args.patches },
    [refEntity(hook)],
    `更新伏笔「${hook.name}」的 ${fieldCount} 个字段`,
  );
}

/** propose_update_hook run */
export function runProposeUpdateHook(
  ctx: ToolContext,
  args: ProposeUpdateHookArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeUpdateHook(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出推进伏笔提案（确认后复合写：delta 记 status=progressing + advances 关系） */
export function buildProposeAdvanceHook(ctx: ToolContext, args: ProposeAdvanceHookArgs): Proposal {
  const hook = requireHook(ctx, args.hook_id);
  const node = requireOutlineNode(ctx, args.node_id);
  return buildProposal(
    ctx,
    "propose_advance_hook",
    { hook_id: args.hook_id, node_id: args.node_id, description: args.description },
    [refEntity(hook), refOutlineNode(node)],
    `推进伏笔「${hook.name}」到节点 ${args.node_id}`,
  );
}

/** propose_advance_hook run */
export function runProposeAdvanceHook(
  ctx: ToolContext,
  args: ProposeAdvanceHookArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeAdvanceHook(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出回收伏笔提案（确认后复合写：delta 记 status=resolved + resolves 关系） */
export function buildProposeResolveHook(ctx: ToolContext, args: ProposeResolveHookArgs): Proposal {
  const hook = requireHook(ctx, args.hook_id);
  const node = requireOutlineNode(ctx, args.node_id);
  return buildProposal(
    ctx,
    "propose_resolve_hook",
    { hook_id: args.hook_id, node_id: args.node_id, description: args.description },
    [refEntity(hook), refOutlineNode(node)],
    `回收伏笔「${hook.name}」于节点 ${args.node_id}`,
  );
}

/** propose_resolve_hook run */
export function runProposeResolveHook(
  ctx: ToolContext,
  args: ProposeResolveHookArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeResolveHook(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出废弃伏笔提案（确认后复合写：delta 记 status=abandoned） */
export function buildProposeAbandonHook(ctx: ToolContext, args: ProposeAbandonHookArgs): Proposal {
  const hook = requireHook(ctx, args.hook_id);
  return buildProposal(
    ctx,
    "propose_abandon_hook",
    { hook_id: args.hook_id, description: args.description },
    [refEntity(hook)],
    `废弃伏笔「${hook.name}」`,
  );
}

/** propose_abandon_hook run */
export function runProposeAbandonHook(
  ctx: ToolContext,
  args: ProposeAbandonHookArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeAbandonHook(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
