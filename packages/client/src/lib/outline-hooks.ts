// 大纲节点伏笔标记纯函数（S9.2）
// 契约来源：doc/database/hooks.md（plants/advances/resolves：outline_node → hook 关系，source 为节点侧、
//   target 为伏笔侧；「大纲节点上的伏笔标记」示意：sc-12 (玉佩的秘密) [📌身世之谜↑]）、
//   doc/design/tasks.md S9.2（大纲节点上 plants/advances/resolves 标记展示；画布标记留 S10）、
//   S9.1 lib/hook-panel.ts 关系解析先例（relationsOfType/name 兜底口径：联表名优先、缺省 id）
// 数据流：Outline.tsx 并行三请求（GET /relation，source_type=outline_node，relation_type 单值）→
//   本模块 buildNodeHookMarks 聚合为「节点 id → 标记列表」→ 节点行 title 尾紧凑徽标渲染
import type { RelationSummaryItem } from "./api";

/** 伏笔标记关系类型（hooks.md：plants 埋下 / advances 推进 / resolves 回收；source = outline_node） */
export const HOOK_MARK_TYPES = ["plants", "advances", "resolves"] as const;

/** 单个标记类型（运行时值 = HOOK_MARK_TYPES 元素） */
export type HookMarkType = (typeof HOOK_MARK_TYPES)[number];

/** 单个节点标记：类型 + 对端伏笔（联表 targetName 优先、id 兜底——同 S9.1 dependencyNames 口径） */
export interface NodeHookMark {
  relationType: HookMarkType;
  /** 对端伏笔 id（relation targetId） */
  hookId: string;
  /** 对端伏笔名（联表 targetName 优先；缺省 targetId） */
  hookName: string;
}

/** 标记类型展示序（hooks.md 生命周期序：埋下 → 推进 → 回收；同节点多标记排列确定化） */
export const HOOK_MARK_TYPE_ORDER: readonly HookMarkType[] = ["plants", "advances", "resolves"];

/** 类型 → 排序位（类型序 + 稳定排序用；未知类型置尾） */
function typeRank(relationType: string): number {
  const idx = HOOK_MARK_TYPE_ORDER.indexOf(relationType as HookMarkType);
  return idx === -1 ? HOOK_MARK_TYPE_ORDER.length : idx;
}

/**
 * 关系行 → 节点标记映射（S9.2 数据流第二步：API 响应 → 按 source_id 分组）。
 * - 过滤（hooks.md 语义防御——查询端已按 source_type/relation_type 过滤，纯函数内再做形状校验防脏数据）：
 *   relation_type ∈ plants/advances/resolves 且 source_type = outline_node 且 target_type = hook；
 *   其余关系（depends_on/involves/plot_edge、hook 作 source 的 plants 等）不构成节点标记
 * - 名称：targetName（联表）优先，缺省 targetId（伏笔在 target 侧——hooks.md 关系约定）
 * - 稳定排序：类型序（HOOK_MARK_TYPE_ORDER）→ 名称 → id（同节点多标记排列确定化，跨请求合并后不乱序）
 * 纯函数：调用方负责取数（Outline.tsx 并行三请求后传入合并结果）；返回 Map 仅含「有标记的节点」
 */
export function buildNodeHookMarks(
  relations: readonly RelationSummaryItem[],
): Map<string, NodeHookMark[]> {
  const marksByNode = new Map<string, NodeHookMark[]>();
  for (const r of relations) {
    // 形状防御：类型必须属于标记集、且符合 hooks.md「outline_node → hook」方向（source 节点侧）
    if (!HOOK_MARK_TYPES.includes(r.relationType as HookMarkType)) continue;
    if (r.sourceType !== "outline_node" || r.targetType !== "hook") continue;
    const mark: NodeHookMark = {
      relationType: r.relationType as HookMarkType,
      hookId: r.targetId,
      hookName: r.targetName ?? r.targetId,
    };
    const list = marksByNode.get(r.sourceId);
    if (list === undefined) marksByNode.set(r.sourceId, [mark]);
    else list.push(mark);
  }
  // 稳定排序（同节点多标记排列确定化；名称相同 → id 兜底保证全序）
  for (const list of marksByNode.values()) {
    list.sort(
      (a, b) =>
        typeRank(a.relationType) - typeRank(b.relationType) ||
        (a.hookName < b.hookName ? -1 : a.hookName > b.hookName ? 1 : 0) ||
        (a.hookId < b.hookId ? -1 : a.hookId > b.hookId ? 1 : 0),
    );
  }
  return marksByNode;
}
