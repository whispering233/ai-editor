// 提案类工具：时间轴事件批量重排（F9，tools.md「提案类」propose_reorder_events）
//
// 语义（决策 26 修订注记 + 决策 14 权限分级）：AI 按 time_label 语义识别事件先后 →
// 产出**有序事件 id 全量序列**（args.event_ids，顺序 = 建议新序）→ 本工具只产出提案对象
// （buildProposal，prop_ 运行时 id），**不落盘、不写任何数据**——排序由用户确认后
// S6.7 reorder_events 执行器落库（与 moveEvent 拖拽权威语义不变：排序结果即 sort_order 线性序）。
//
// 生成时校验（决策 14/19 语义延伸）：
// - args.event_ids 与当前**全部未软删事件** id 集合**完全相等**（缺/多/重复 → 抛错——
//   LLM 幻觉漏事件时工具报错喂回自纠；软删事件不参与集合，决策 12 过滤）
// - references = 每个事件的 refEntity（自身 updated_at 快照）——确认时 S7.5 重校验
//   存在性 + updated_at（用户拖拽改序后 AI 提案自动失效，409 PROPOSAL_STALE）
// - preview = { changes: [...] }（Proposal.preview，F9 起可选字段）：仅列**位置变化**的
//   事件（对比当前序与新序，1-based 位置，人类可读；name 缺失/空串用 id 兜底）——
//   完整预览经 SSE proposal 事件推送 GUI 展示提案卡
//
// tool_result 语义（tools.md 2026-08 修订）：run 只返回 { proposal_id, summary }，不含预览细节。

import { listAllEvents } from "@whispering233/ai-editor-db";
import type { ProposeReorderEventsArgs } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { buildProposal, checkProposalAborted, refEntity, type Proposal, type ToolProposalResult } from "./types.js";

/**
 * 校验 args.event_ids 与当前事件 id 集合完全相等（缺/多/重复 → 抛错）。
 * 集合比较自动覆盖重复：orderedIds 含重复时 Set 大小 < 数组长度，必然无法相等。
 * 缺失 = 当前集合有而新序没有（漏事件）；多余 = 新序含当前集合没有的 id（不存在/已软删）——
 * 错误信息列出两类 id（截断展示），LLM 幻觉漏事件时工具报错喂回自纠。
 */
function assertEventSetMatches(orderedIds: string[], currentIds: string[]): void {
  const current = new Set(currentIds);
  const orderedSet = new Set(orderedIds);
  const missing = currentIds.filter((id) => !orderedSet.has(id));
  const extra = orderedIds.filter((id) => !current.has(id));
  if (orderedSet.size !== orderedIds.length || missing.length > 0 || extra.length > 0) {
    const dup = orderedSet.size !== orderedIds.length ? "（含重复）" : "";
    const brief = (ids: string[]): string =>
      ids.length === 0 ? "" : `（${ids.slice(0, 5).join(", ")}${ids.length > 5 ? "…" : ""}）`;
    throw new Error(
      `事件集合与当前时间轴不一致${dup}: 缺失 ${missing.length} 个${brief(missing)}、多余 ${extra.length} 个${brief(extra)}`,
    );
  }
}

/**
 * 产出时间轴重排提案。
 * 1. 读当前全部未软删事件（listAllEvents：sort_order 升序，NULL 沉底——与列表/执行层
 *    同款单一事实来源查询，排序语义一致）
 * 2. 校验 event_ids 与当前集合完全相等（缺/多/重复 → 抛错，防 LLM 幻觉漏事件）
 * 3. references = 全部事件 updated_at 快照（决策 14：确认时任一过期即 STALE）
 * 4. preview.changes：仅列位置变化事件（「「<name>」从第 X 位移到第 Y 位」，1-based）
 */
export function buildProposeReorderEvents(ctx: ToolContext, args: ProposeReorderEventsArgs): Proposal {
  // 当前序（listAllEvents 与列表页/moveEvent/reorderEvents 同款排序：sort_order 升序、NULL 沉底）
  const events = listAllEvents(ctx.db);
  assertEventSetMatches(args.event_ids, events.map((e) => e.id));
  // 事件行按 id 索引（集合相等校验已保证 args.event_ids 全覆盖、无重复）
  const byId = new Map(events.map((e) => [e.id, e]));
  // 当前序位置索引（preview 对比基准：oldPos = 事件在现有时间轴上的位置）
  const currentIndex = new Map(events.map((e, i) => [e.id, i]));
  // references 按**新序**（args.event_ids）逐事件快照（决策 14：确认时 S7.5 逐一比对
  // 存在性 + updated_at，任一过期即 STALE）——顺序即建议新序，校验遍历顺序与执行一致
  const references = args.event_ids.map((id) => refEntity(byId.get(id)!));
  // preview.changes 按新序排列（提案卡按最终时间轴顺序从上到下展示变化，1-based）；
  // 仅列位置变化的事件（name 缺失/空串用 id 兜底）
  const changes: string[] = [];
  for (let newPos = 0; newPos < args.event_ids.length; newPos++) {
    const id = args.event_ids[newPos];
    const oldPos = currentIndex.get(id)!; // 集合相等校验已保证存在
    if (oldPos === newPos) continue; // 位置未变的事件不进预览
    const event = byId.get(id)!;
    const label = event.name !== "" ? event.name : id;
    changes.push(`「${label}」从第 ${oldPos + 1} 位移到第 ${newPos + 1} 位`);
  }
  return buildProposal(
    ctx,
    "propose_reorder_events",
    { event_ids: args.event_ids },
    references, // 全部事件 updated_at 快照（决策 14）
    `按时间标签语义排序 ${events.length} 个事件`,
    { changes }, // preview：顺序变化说明（SSE proposal 事件推送 GUI 提案卡）
  );
}

/** propose_reorder_events run：中止检查 + 产出裁剪结果（tool_result 不含预览，tools.md 2026-08 修订） */
export function runProposeReorderEvents(
  ctx: ToolContext,
  args: ProposeReorderEventsArgs,
  signal?: AbortSignal,
): ToolProposalResult {
  checkProposalAborted(signal);
  const proposal = buildProposeReorderEvents(ctx, args);
  return { proposal_id: proposal.proposal_id, summary: proposal.summary };
}
