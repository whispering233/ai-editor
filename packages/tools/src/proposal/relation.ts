// 提案类工具：关系（S6.6，「提案类」2 个）
// propose_add_relation / propose_remove_relation
//
// 语义：只产出提案对象并返回 { proposal_id, summary }（2026-08 修订：tool_result 不含预览）；
// **不落盘、不写任何数据**（本模块零写操作——与 S6.7 add_relation/remove_relation 对比的核心差异）。
//
// 生成时校验：
// - propose_add_relation：source/target 端点存在且未软删（resolveEndpoint：实体表优先、
// 其次大纲树），采集各端点 updated_at 快照；args 规范化为执行形态
// （source_type/source_id/target_type/target_id/relation_type/metadata——S6.7 执行时可直接透传）
// - **伏笔锚点仅章（卡片 1.3 + 5.2）**：`plants`/`advances`/`resolves` **无条件**要求源端为
// **章**大纲节点（requireChapterNode，与 REST 创建路径 server relation.ts 同口径）——
// 卷/场景拒绝；「源端为实体」的反向组合（无消费者，数据卫生）同样拒绝。
// - propose_remove_relation：关系存在且可见（getRelation 已含端点软删联动过滤），
// 采集关系自身 updated_at 快照

import { getRelation } from "@whispering233/ai-editor-db";
import { HOOK_RELATION_TYPES } from "@whispering233/ai-editor-shared";
import type { ProposeAddRelationArgs, ProposeRemoveRelationArgs } from "../schemas/index.js";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refRelation, requireChapterNode, resolveEndpoint, type Proposal, type ToolProposalResult } from "./types.js";

/** 产出新增关系提案（端点类型生成时自动识别，执行形态规范化到 args） */
export function buildProposeAddRelation(ctx: ToolContext, args: ProposeAddRelationArgs): Proposal {
  const source = resolveEndpoint(ctx, args.source);
  const target = resolveEndpoint(ctx, args.target);
 // 伏笔关系源端仅章（卡片 1.3 + 5.2）：先拒非大纲节点源端（反向组合无消费者），
 // 再校验大纲节点为章——两步文案分开，避免「实体源端」报成「大纲节点不存在」误导
  if ((HOOK_RELATION_TYPES as readonly string[]).includes(args.type)) {
    if (source.type !== "outline_node") {
      throw new Error(`伏笔关系（${args.type}）的源端须为章大纲节点，当前为 ${source.type}: ${args.source}`);
    }
    requireChapterNode(ctx, args.source);
  }
 // 执行信息：派生端点类型 + 原样透传 relation_type/metadata（S6.7 add_relation 直接消费）
  const executeArgs: Record<string, unknown> = {
    source_type: source.type,
    source_id: args.source,
    target_type: target.type,
    target_id: args.target,
    relation_type: args.type,
    ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
  };
  return buildProposal(
    ctx,
    "propose_add_relation",
    executeArgs,
    [source.ref, target.ref],
    `新增关系: ${args.source} —${args.type}→ ${args.target}`,
  );
}

/** propose_add_relation run */
export function runProposeAddRelation(
  ctx: ToolContext,
  args: ProposeAddRelationArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeAddRelation(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出移除关系提案（确认后物理删，不进回收站） */
export function buildProposeRemoveRelation(ctx: ToolContext, args: ProposeRemoveRelationArgs): Proposal {
  const relation = getRelation(ctx.db, args.relation_id, ctx.outlineDir);
  if (relation === null) {
    throw new Error(`关系不存在或不可见: ${args.relation_id}`);
  }
  return buildProposal(
    ctx,
    "propose_remove_relation",
    { relation_id: args.relation_id },
    [refRelation(relation)],
    `移除关系 ${relation.source_type}/${relation.source_id} —${relation.relation_type}→ ${relation.target_type}/${relation.target_id}`,
  );
}

/** propose_remove_relation run */
export function runProposeRemoveRelation(
  ctx: ToolContext,
  args: ProposeRemoveRelationArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeRemoveRelation(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
