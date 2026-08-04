// 提案类工具：Delta（S6.6，tools.md「提案类」1 个）
// propose_add_delta
//
// 语义：只产出提案对象并返回 { proposal_id, summary }（2026-08 修订：tool_result 不含预览）；
// **不落盘、不写任何数据**（与 S6.7 add_delta 对比的核心差异）。
//
// 生成时校验（决策 14/19）：
// - 触发节点（node_id）存在且未软删（requireOutlineNode，决策 12）——节点级 updated_at 快照
// - 变更目标（target）存在且未软删（resolveEndpoint：实体或大纲节点）——端点 updated_at 快照
//   **target 可为大纲节点**：S13.3 收紧的是 UI 创建入口（仅实体）；AI 提案通道保持大纲
//   target 是 tools.md「提案类」/get_delta_history（target_type 含 outline_node）的既有契约
//   能力，本卡维持，非回归
// - changes 由 schema 校验（复用 deltaChangeSchema，至少一项）
// args 规范化为执行形态 { node_id, target_type, target_id, changes }（S6.7 add_delta 直接消费）；
// delta_records.description（NOT NULL）在确认后由 S6.7 执行器取 proposal.summary 作为人类可读描述。

import type { ProposeAddDeltaArgs } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refOutlineNode, requireOutlineNode, resolveEndpoint, type Proposal, type ToolProposalResult } from "./types.js";

/** 产出追加 Delta 提案 */
export function buildProposeAddDelta(ctx: ToolContext, args: ProposeAddDeltaArgs): Proposal {
  const node = requireOutlineNode(ctx, args.node_id);
  const target = resolveEndpoint(ctx, args.target);
  return buildProposal(
    ctx,
    "propose_add_delta",
    { node_id: args.node_id, target_type: target.type, target_id: args.target, changes: args.changes },
    [refOutlineNode(node), target.ref],
    `为节点「${node.title}」追加 ${args.changes.length} 项属性变更（目标: ${args.target}）`,
  );
}

/** propose_add_delta run */
export function runProposeAddDelta(
  ctx: ToolContext,
  args: ProposeAddDeltaArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeAddDelta(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
