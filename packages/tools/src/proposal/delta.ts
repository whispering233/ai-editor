// 提案类工具：Delta（S6.6，「提案类」1 个）
// propose_add_delta
//
// 语义：只产出提案对象并返回 { proposal_id, summary }（2026-08 修订：tool_result 不含预览）；
// **不落盘、不写任何数据**（与 S6.7 add_delta 对比的核心差异）。
//
// 生成时校验：
// - 触发节点（node_id）存在且未软删（requireOutlineNode）——节点级 updated_at 快照
// - **触发节点仅章（卡片 1.2）**：卷/场景拒绝（与 REST 创建路径 server delta.ts
//   assertDeltaAnchorChapter 一致）——一章一个状态变化点才是叙事粒度；
//   **只限写入侧**：compute_state 的 at_node_id 不限层级
// - 变更目标（target）存在且未软删（resolveEndpoint：实体或大纲节点）——端点 updated_at 快照
// **target 可为大纲节点**：S13.3 收紧的是 UI 创建入口（仅实体）；AI 提案通道保持大纲
// target 是 「提案类」/get_delta_history（target_type 含 outline_node）的既有
// 能力，本卡维持，非回归
// - **target 不可为 event（event 不产生 Delta，oracle 审查口径）**：与 REST 创建
// 路径（server delta.ts assertDeltaTargetType）一致拒绝；outline_node 有 S13.3 显式豁免
// （UI 收紧、AI 通道保持），event 无豁免——resolveEndpoint 解析出 event 即抛错
// - **character 不可变字段（卡片 5.2）**：目标为 character 时，changes 不得包含
// `role`/`description`（与前端字段下拉白名单同源）——二者是列表摘要与 AI 检索的依据，
// 允许 Delta 改会与 `entities.name`/摘要读取面产生“同一人物两个值”（见
// `docs/db/schema.md`「人物 data 分层」/`docs/design/10-data-model.md` §14 不变式 1）
// - changes 由 schema 校验（复用 deltaChangeSchema，至少一项）
// args 规范化为执行形态 { node_id, target_type, target_id, changes }（S6.7 add_delta 直接消费）；
// delta_records.description（NOT NULL）在确认后由 S6.7 执行器取 proposal.summary 作为人类可读描述。

import type { ProposeAddDeltaArgs } from "../schemas/index.js";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refOutlineNode, requireOutlineNode, resolveEndpoint, type Proposal, type ToolProposalResult } from "./types.js";

/** character 不可变字段（不参与 Delta——与前端 `lib/delta-create` 的 `IMMUTABLE_FIELDS` 同源）：
 * 人工经 `PUT` 直接编辑；它们同时是列表摘要与 AI 检索的依据，允许 Delta 改会产生“同一人物两个值” */
const IMMUTABLE_CHARACTER_FIELDS = new Set(["role", "description"]);

/** 产出追加 Delta 提案 */
export function buildProposeAddDelta(ctx: ToolContext, args: ProposeAddDeltaArgs): Proposal {
  const node = requireOutlineNode(ctx, args.node_id);
 // 锚点仅章（卡片 1.2）：卷/场景拒绝——与 REST 路径 assertDeltaAnchorChapter 同口径
  if (node.type !== "chapter") {
    throw new Error(`变更记录的触发节点须为章（卷/场景不承载变更记录）: ${args.node_id}`);
  }
  const target = resolveEndpoint(ctx, args.target);
 // event（时间轴事件）不产生 Delta——AI 提案通道与 REST 创建路径一致拒绝
 //（outline_node 有 S13.3 显式豁免，event 无豁免）
  if (target.type === "event") {
    throw new Error(`event（时间轴事件）不产生 Delta，变更目标无效: ${args.target}`);
  }
 // character 不可变字段（卡片 5.2）：role/description 不参与变更记录（与前端字段下拉白名单同源）
  if (target.type === "character") {
    for (const change of args.changes) {
      const field = (change as { field?: unknown } | null)?.field;
      if (typeof field === "string" && IMMUTABLE_CHARACTER_FIELDS.has(field)) {
        throw new Error(`character 的不可变字段不参与变更记录（请直接编辑）: ${field}`);
      }
    }
  }
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
