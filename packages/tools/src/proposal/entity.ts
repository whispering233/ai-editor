// 提案类工具：实体（S6.6，tools.md「提案类」3 个）
// propose_create_entity / propose_update_entity / propose_delete_entity
//
// 语义：AI 不能直接修改数据——build 函数只**产出提案对象**（buildProposal，prop_ 运行时 id），
// run 返回 { proposal_id, summary }（tools.md 2026-08 修订：tool_result 不含预览细节，
// 防 LLM 误以为提案已生效而重复提案）；**不落盘、不写任何数据**（与 S6.7 执行工具的核心差异——
// 本模块零写操作）。
// 生成时校验（决策 14/19）：引用实体存在且未软删（getEntity 已过滤软删，决策 12），
// 采集实体自身 updated_at 快照供确认时比对。
//
// 参数契约：packages/shared/src/types/tool.ts propose*ArgsSchema（snake_case 与 tools.md 对齐）

import { getEntity } from "@whispering233/ai-editor-db";
import type { ProposeCreateEntityArgs, ProposeDeleteEntityArgs, ProposeUpdateEntityArgs } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refEntity, type Proposal, type ToolProposalResult } from "./types.js";

/** 产出创建实体提案（无引用对象——新实体 id 由 S6.7 执行时生成） */
export function buildProposeCreateEntity(ctx: ToolContext, args: ProposeCreateEntityArgs): Proposal {
  // 引用为空：不依赖任何现存对象（type/name/data 已由 schema 校验）
  return buildProposal(
    ctx,
    "propose_create_entity",
    { type: args.type, name: args.name, ...(args.data === undefined ? {} : { data: args.data }) },
    [],
    `创建实体「${args.name}」（${args.type}）`,
  );
}

/** propose_create_entity run：中止检查 + 产出裁剪结果 */
export function runProposeCreateEntity(
  ctx: ToolContext,
  args: ProposeCreateEntityArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeCreateEntity(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出更新实体提案（引用实体存在 + updated_at 快照，决策 14） */
export function buildProposeUpdateEntity(ctx: ToolContext, args: ProposeUpdateEntityArgs): Proposal {
  const entity = getEntity(ctx.db, args.entity_id);
  if (entity === null) {
    throw new Error(`实体不存在或已软删: ${args.entity_id}`);
  }
  const fieldCount = Object.keys(args.patches).length;
  return buildProposal(
    ctx,
    "propose_update_entity",
    { entity_id: args.entity_id, patches: args.patches },
    [refEntity(entity)],
    `更新实体「${entity.name}」的 ${fieldCount} 个字段`,
  );
}

/** propose_update_entity run */
export function runProposeUpdateEntity(
  ctx: ToolContext,
  args: ProposeUpdateEntityArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeUpdateEntity(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}

/** 产出删除实体提案（软删 + 级联关系与 Delta，可回收站还原，决策 12） */
export function buildProposeDeleteEntity(ctx: ToolContext, args: ProposeDeleteEntityArgs): Proposal {
  const entity = getEntity(ctx.db, args.entity_id);
  if (entity === null) {
    throw new Error(`实体不存在或已软删: ${args.entity_id}`);
  }
  return buildProposal(
    ctx,
    "propose_delete_entity",
    { entity_id: args.entity_id },
    [refEntity(entity)],
    `删除实体「${entity.name}」（${entity.type}，软删可还原）`,
  );
}

/** propose_delete_entity run */
export function runProposeDeleteEntity(
  ctx: ToolContext,
  args: ProposeDeleteEntityArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeDeleteEntity(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
