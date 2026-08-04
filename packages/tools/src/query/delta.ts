// 查询类工具：Delta 侧实现（S6.3）
// compute_state / get_delta_history（tools.md「状态查询（Delta 相关）」）
// 契约来源：doc/api/tools.md；doc/api/endpoints.md Delta 端点；决策 9（父链累积、
//   conflicts 跳过语义）、决策 12 修订（可见性三态过滤）、决策 19（严格三层路径唯一）。
//
// db 层能力确认与分工（S6.3 修复轮：数据访问一律走 db 查询层，工具层无原生 SQL）：
// - compute_state：db computeState 已封装全部语义（父链双层排序累积、op=update from
//   校验失败跳过 + conflicts 标注不返回 409、软删过滤、目标实体缺失返回 null）——
//   工具层参数映射透传；at_node_id 不存在时 db 抛错（视为调用方 bug，路由层前置校验
//   的约定），工具层不捕获——executor 统一转结构化错误喂回 LLM 自纠
// - get_delta_history：db listDeltasByTarget（S6.3 下沉）已实现按目标端点查询 +
//   可见性三态过滤（delta 自身/触发节点/目标端点软删，决策 12 修订，与 listDeltasByNode
//   共享 filterVisibleDeltas 实现）——工具层一行透传

import { computeState as dbComputeState, listDeltasByTarget } from "@whispering233/ai-editor-db";
import type { ComputeStateResult, DeltaRecord } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import type { ComputeStateArgs, GetDeltaHistoryArgs } from "@whispering233/ai-editor-shared";

// ============ compute_state ============

/**
 * 实体到达指定节点时的累积状态（tools.md compute_state(target_type, target_id, at_node_id)）。
 * 透传 db computeState：只沿大纲树父链（根 → at_node_id）累积已确认 Delta（决策 9），
 * 节点间按树路径序、节点内按 order 双层排序；plot_edge 不参与；op=update from 校验失败
 * **跳过该 change 并继续累积**，结果在 conflicts 中标注 { field, expected, actual }
 * （不返回 409——手动编辑 data 属正常用户行为，决策 9 修订）。
 * 目标实体不存在/已软删 → null；at_node_id 不存在 → db 抛错（上层按工具失败处理）。
 */
export function runComputeState(ctx: ToolContext, args: ComputeStateArgs): ComputeStateResult | null {
  return dbComputeState(ctx.db, ctx.outlineDir, {
    targetType: args.target_type,
    targetId: args.target_id,
    atNodeId: args.at_node_id,
  });
}

// ============ get_delta_history ============

/**
 * 目标实体的全部属性变更记录（tools.md get_delta_history(target_type, target_id)）。
 * 透传 db listDeltasByTarget：按 target_id 查询 + 全局 order ASC（时间序）排序 +
 * 可见性三态过滤（决策 12 修订：delta 自身 / 触发节点 / 目标端点任一软删即不可见）+
 * targetName 联表填充。target_type 仅由 db 侧用于判定目标端点类型（实体/大纲节点）。
 */
export function runGetDeltaHistory(ctx: ToolContext, args: GetDeltaHistoryArgs): DeltaRecord[] {
  return listDeltasByTarget(ctx.db, args.target_id, ctx.outlineDir);
}
