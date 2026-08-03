// 提案类工具：大纲（S6.6，tools.md「提案类」3 个）
// propose_outline_node / propose_move_node / propose_delete_node
//
// 语义：只产出提案对象并返回 { proposal_id, summary }（2026-08 修订：tool_result 不含预览）；
// **不落盘、不写任何数据**（与 S6.7 create_outline_node/move_node/delete_node 对比的核心差异）。
//
// 生成时校验（决策 14/19/12）：
// - propose_outline_node：parent_id 缺省挂根（volume/chapter 可挂 root，scene 必须挂 chapter——
//   assertCanHold 抛 INVALID_HIERARCHY）；父节点存在且未软删时采集节点级 updated_at 快照
// - propose_move_node：节点与目标父均存在且未软删，且目标父可容纳该层级（严格三层）；
//   采集两节点 updated_at 快照
// - propose_delete_node：节点存在且未软删（软删 + 递归子树，可回收站还原，决策 12）

import { assertCanHold } from "@ai-editor/db";
import type { ProposeDeleteNodeArgs, ProposeMoveNodeArgs, ProposeOutlineNodeArgs } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refOutlineNode, requireOutlineNode, type Proposal, type ProposalReference, type ToolProposalResult } from "./types.js";

/** 产出新增大纲节点提案（parent_id 缺省挂根；scene 无 parent 直接拒绝，决策 19） */
export function buildProposeOutlineNode(ctx: ToolContext, args: ProposeOutlineNodeArgs): Proposal {
  // 层级约束（决策 19 严格三层）：root 可挂 volume/chapter；scene 必须挂 chapter（缺省 root 即拒绝）
  const references: ProposalReference[] = [];
  if (args.parent_id === undefined) {
    assertCanHold("root", args.type);
  } else {
    const parent = requireOutlineNode(ctx, args.parent_id);
    assertCanHold(parent.type, args.type);
    references.push(refOutlineNode(parent));
  }
  return buildProposal(
    ctx,
    "propose_outline_node",
    { type: args.type, title: args.title, ...(args.parent_id === undefined ? {} : { parent_id: args.parent_id }) },
    references,
    `新增大纲节点「${args.title}」（${args.type}${args.parent_id === undefined ? "，挂根" : `，挂 ${args.parent_id}`}）`,
  );
}

/** propose_outline_node run */
export function runProposeOutlineNode(
  ctx: ToolContext,
  args: ProposeOutlineNodeArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeOutlineNode(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/**
 * 产出移动大纲节点提案（目标父须可容纳该层级，决策 19）。
 * parent_id 可为 "root"（决策 19：volume/chapter 可挂 root——db moveOutlineNode 支持
 * parentId === "root"，AI 可提案「把卷移到树首」等合法操作）：root 恒存在、非节点，
 * 跳过 requireOutlineNode 且**不采集 root 引用快照**（与 propose_outline_node 缺省挂根语义对齐）；
 * 此时层级约束只取决于 node 自身类型（volume/chapter 可挂 root，scene 不可）。
 * order 语义：目标父 children 数组中的目标位置（0 起）；超出长度的行为（clamp 或抛错）
 * 由 S6.7/db 执行时定义，生成时校验不做上限（见 schema 注释）。
 */
export function buildProposeMoveNode(ctx: ToolContext, args: ProposeMoveNodeArgs): Proposal {
  const node = requireOutlineNode(ctx, args.node_id);
  const references = [refOutlineNode(node)];
  // 目标父展示名（root 恒存在、非节点，无 title）
  let parentLabel = "树根";
  if (args.parent_id === "root") {
    // root 恒存在、非引用对象：仅校验层级（scene 不能挂 root，决策 19 严格三层）
    assertCanHold("root", node.type);
  } else {
    const parent = requireOutlineNode(ctx, args.parent_id);
    assertCanHold(parent.type, node.type);
    references.push(refOutlineNode(parent));
    parentLabel = `「${parent.title}」`;
  }
  return buildProposal(
    ctx,
    "propose_move_node",
    { node_id: args.node_id, parent_id: args.parent_id, order: args.order },
    references,
    `移动节点「${node.title}」到${parentLabel}下第 ${args.order} 位`,
  );
}

/** propose_move_node run */
export function runProposeMoveNode(
  ctx: ToolContext,
  args: ProposeMoveNodeArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeMoveNode(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出删除大纲节点提案（软删 + 递归子树，可回收站还原，决策 12） */
export function buildProposeDeleteNode(ctx: ToolContext, args: ProposeDeleteNodeArgs): Proposal {
  const node = requireOutlineNode(ctx, args.node_id);
  return buildProposal(
    ctx,
    "propose_delete_node",
    { node_id: args.node_id },
    [refOutlineNode(node)],
    `删除大纲节点「${node.title}」（${node.type}，含子树，软删可还原）`,
  );
}

/** propose_delete_node run */
export function runProposeDeleteNode(
  ctx: ToolContext,
  args: ProposeDeleteNodeArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeDeleteNode(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
