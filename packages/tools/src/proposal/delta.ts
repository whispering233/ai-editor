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
// - **character 已移除字段（卡片 5.4 / 5.5）**：`status`/`abilities` 已从 schema 移除（status 无展示面、
// abilities 经 007 迁为 `ability_panel`）——允许写入只是脏键残留；白名单单一事实源 = shared
// `constants/delta.ts` 的 `REMOVED_CHARACTER_FIELDS`（提案层与 executor 同源，见下）
// - **事实字段只能用 set（卡片 5.3 / 5.5）**：hook 的 `status` 是物化事实字段（写路径同步当前值、
// 终态守卫/列表分组/AI 统计直接读它）——用 `op=update`+`from` 重放必然假冲突
// （重放基座即最新值）；白名单单一事实源 = shared `constants/delta.ts` 的 `SET_ONLY_FIELDS`
// - changes 由 schema 校验（复用 deltaChangeSchema，至少一项）
// args 规范化为执行形态 { node_id, target_type, target_id, changes }（S6.7 add_delta 直接消费）；
// delta_records.description（NOT NULL）在确认后由 S6.7 执行器取 proposal.summary 作为人类可读描述。

import type { ProposeAddDeltaArgs } from "../schemas/index.js";
import type { ToolContext } from "../context.js";
// 白名单单一事实源（卡片 5.5 / 5.6）：client 与 tools 共消费 shared 常量，禁止各自手抄
import { IMMUTABLE_FIELDS, REMOVED_CHARACTER_FIELDS, SET_ONLY_FIELDS } from "@whispering233/ai-editor-shared";
import { buildProposal, checkProposalAborted, refOutlineNode, requireOutlineNode, resolveEndpoint, type Proposal, type ToolProposalResult } from "./types.js";

/**
 * 事实字段守卫：`targetType` 的事实字段（shared `SET_ONLY_FIELDS`）出现非 `set` 的 op → 抛错。
 * **提案层与 executor 层共用同一实现**（executor 直写 db、绕过提案层；两处白名单/文案不得漂移）。
 * 防御：非对象 change 项静默跳过（与 `computeState` 的坏项防御同风格）。
 */
export function assertFactFieldsSetOnly(targetType: string, changes: readonly unknown[]): void {
  const setOnlyFields = SET_ONLY_FIELDS[targetType];
  if (setOnlyFields === undefined) return;
  for (const change of changes) {
    const c = change as { field?: unknown; op?: unknown } | null;
    const field = c === null || typeof c !== "object" ? undefined : c.field;
    if (typeof field === "string" && setOnlyFields.includes(field) && c?.op !== "set") {
      throw new Error(
        `${targetType} 的 ${field} 是写路径同步的事实字段，变更记录只能用 op=set（当前 op=${String(c?.op ?? "(缺失)")}）`,
      );
    }
  }
}

/**
 * character 已移除字段守卫（卡片 5.4 / 5.5）：field ∈ shared `REMOVED_CHARACTER_FIELDS` → 抛错。
 * **提案层与 executor 层共用同一实现**（同 `assertFactFieldsSetOnly` 模式）；
 * 防御：非对象 change 项静默跳过。
 */
export function assertRemovedCharacterFields(targetType: string, changes: readonly unknown[]): void {
  if (targetType !== "character") return;
  for (const change of changes) {
    const c = change as { field?: unknown } | null;
    const field = c === null || typeof c !== "object" ? undefined : c.field;
    if (typeof field === "string" && REMOVED_CHARACTER_FIELDS.includes(field)) {
      throw new Error(`character 的 ${field} 字段已移除（请改用可变字段/能力面板）`);
    }
  }
}

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
 // character 不可变字段（卡片 5.2 / 5.6）：role/description 不参与变更记录（请直接编辑）
 // 白名单单一事实源 = shared `IMMUTABLE_FIELDS`（与前端字段下拉同源，禁止手抄）
  if (target.type === "character") {
    const immutable = IMMUTABLE_FIELDS.character ?? [];
    for (const change of args.changes) {
      const field = (change as { field?: unknown } | null)?.field;
      if (typeof field === "string" && immutable.includes(field)) {
        throw new Error(`character 的不可变字段不参与变更记录（请直接编辑）: ${field}`);
      }
    }
  }
 // character 已移除字段（卡片 5.4 / 5.5）：status/abilities 已从 schema 移除——写入只是脏键残留
 // （守卫实现与 executor 同源，白名单来自 shared `REMOVED_CHARACTER_FIELDS`）
  assertRemovedCharacterFields(target.type, args.changes);
 // 事实字段只能用 set（卡片 5.3）：hook.status 用 update/from 重放必然假冲突（写路径同步了最新值）
  assertFactFieldsSetOnly(target.type, args.changes);
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
