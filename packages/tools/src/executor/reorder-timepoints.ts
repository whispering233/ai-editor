// 执行类工具：时间轴时间点重排（G2，tools.md「执行类」）
// reorder_timepoints
//
// 与提案工具的核心差异：**直接调 db 写层落库**（唯一写路径，S7.5 确认后由 executor 门面调用）；
// 抛错即失败。不注册 registry（执行类不暴露给 LLM，tools.md「核心设计原则」）。
//
// 语义（G2，决策 26 修订注记）：args.timepoint_ids 为 LLM 排序提案的有序时间点 id 全量序列——
// 非空去重校验 → 读当前全部未软删时间点（listTimepoints）→ **集合相等校验**（缺/多/重复 →
// 抛错，与提案层同款：防御纵深，兜底「S7.5 references 快照校验已拦截但确认前用户又拖拽
// 增删」的竞态）→ 调 db reorderTimepoints 按新序事务内重写 sort_order 0..n-1（拖拽权威语义
// 不变，决策 26 G2 修订：排序结果即 timepoint.sort_order 线性序；不改其下事件序——
// 双独立线性序）→ 返回 { reordered: n }。

import { listTimepoints, nowIso, reorderTimepoints } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import type { Proposal } from "../proposal/types.js";
import { requireArray, type ExecutorResult } from "./types.js";

/** reorder_timepoints（tools.md：reorder_timepoints(timepoint_ids) → { reordered }） */
export function executeReorderTimepoints(ctx: ToolContext, proposal: Proposal): ExecutorResult {
  const raw = requireArray(proposal.args, "timepoint_ids");
  // 元素防御：提案层 zod 已校验为 string[]，此处防脏调用（与 requireString 同风格）
  const timepointIds = raw.map((v) => {
    if (typeof v !== "string" || v === "") {
      throw new Error(`执行参数缺失或非法: timepoint_ids`);
    }
    return v;
  });
  if (timepointIds.length === 0) {
    throw new Error(`执行参数缺失或非法: timepoint_ids`);
  }
  // 去重校验（重复 id 意味着集合不一致——显式拒绝，避免静默按去重后序重排）
  const unique = new Set(timepointIds);
  if (unique.size !== timepointIds.length) {
    throw new Error(`时间点集合与当前时间轴不一致（含重复）: timepoint_ids`);
  }
  // 集合相等校验（缺/多 → 抛错；db 层 reorderTimepoints 事务内同款校验兜底，此处先行给出明确错误）
  // 语义与 db/proposal 层统一（G2）：缺失 = 当前集合有而新序没有（漏时间点，LLM 幻觉）；
  // 多余 = 新序含当前集合没有的 id（不存在/已软删）
  const currentIds = new Set(listTimepoints(ctx.db).map((t) => t.id));
  const missing = [...currentIds].filter((id) => !unique.has(id));
  const extra = timepointIds.filter((id) => !currentIds.has(id));
  if (missing.length > 0 || extra.length > 0) {
    const firstOf = (ids: string[]): string => {
      const head = ids.slice(0, 5).join(",");
      return ids.length > 5 ? `${head}…` : head;
    };
    throw new Error(
      `时间点集合与当前时间轴不一致: 缺失 ${missing.length} 个（${firstOf(missing)}）、多余 ${extra.length} 个（${firstOf(extra)}）`,
    );
  }
  const reordered = reorderTimepoints(ctx.db, timepointIds, nowIso());
  return { reordered };
}
