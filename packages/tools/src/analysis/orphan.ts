// 分析类工具：find_orphan_elements（孤立元素诊断，S6.4）
// 契约来源：doc/api/tools.md「孤立元素」→ { unused_characters, unresolved_deltas,
//   dangling_relations, inconsistent_soft_deletes }
// 语义（四维诊断，全项目扫描）：
// 1. unused_characters：闲置角色——从未出场（无 appears_in 且无属性变更记录），或
//    最后活跃章序号 < 当前最新章序号（「写到第30章但角色C第10章后就没出现」，决策 21 章序号现推）
// 2. unresolved_deltas：未解决变更——delta 自身未软删但已不可见（触发节点缺失 /
//    目标端点软删或缺失），永不生效的「幽灵变更」
// 3. dangling_relations：悬空关系——关系自身未软删但端点已物理删除（purge 残留）
// 4. inconsistent_soft_deletes：跨存储软删不一致——大纲节点已软删但关联 relation/delta
//    未级联软删（「可见记录指向已软删节点」的幽灵形态；诊断用途，兜底修复由启动一致性校验承担，
//    决策 16 修订——本工具只诊断与引导修复）
// 数据访问：db 查询层（listEntities/listRelations/listDeltasByTarget/listDanglingDeltas/
//   listDanglingRelations/deriveChapterOrder/getChapterNumber）+ 纯函数分析，无原生 SQL。
// signal：多角色 × 多记录的遍历为长任务候选，循环中检查（决策 16 ③）。

import {
  listDanglingDeltas,
  listDanglingRelations,
  listDeltasByTarget,
  listEntities,
  listRelations,
} from "@ai-editor/db";
import type { ToolContext } from "../context.js";
import { buildChapterIndex, throwIfAborted } from "./utils.js";
import type { FindOrphanElementsArgs } from "@ai-editor/shared";

/** 闲置角色条目 */
export interface UnusedCharacter {
  id: string;
  name: string;
  /** 最后活跃章序号（从未出场为 null） */
  lastActiveChapter: number | null;
  description: string;
}

/** 未解决变更条目（delta 自身未软删但不可见） */
export interface UnresolvedDelta {
  id: string;
  nodeId: string;
  targetType: string;
  targetId: string;
  description: string;
  /** 不可见原因（listDanglingDeltas reason，触发/目标侧） */
  reason: string;
}

/** 悬空关系条目（端点已物理删除） */
export interface DanglingRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  reason: string;
}

/** 跨存储软删不一致条目（大纲节点软删但 DB 记录未级联） */
export interface InconsistentSoftDelete {
  kind: "relation" | "delta";
  recordId: string;
  /** delta 侧：触发节点 id；relation 侧：null */
  nodeId: string | null;
  /** relation 侧：已软删的端点 id；delta 侧：null */
  endpointId: string | null;
  description: string;
}

/** 孤立元素诊断结果（tools.md find_orphan_elements 返回结构） */
export interface OrphanElementsResult {
  unused_characters: UnusedCharacter[];
  unresolved_deltas: UnresolvedDelta[];
  dangling_relations: DanglingRelation[];
  inconsistent_soft_deletes: InconsistentSoftDelete[];
}

/**
 * 角色活跃度：appears_in 目标节点 + Delta 触发节点合并去重（卷级节点无章号，跳过）。
 * @returns { active, lastChapter }——active=false 表示从未出场；lastChapter 为最后活跃
 *   章序号（活跃点均在卷级等无章号节点时为 null，不做宽松猜测）。
 * 章序号经共享 ChapterIndex（决策 21 口径，S6.5 与伏笔工具同源）。
 */
function activityOf(
  ctx: ToolContext,
  chapterIndex: ReturnType<typeof buildChapterIndex>,
  characterId: string,
  appearsIn: Map<string, string[]>,
): { active: boolean; lastChapter: number | null } {
  const activeNodeIds = new Set<string>();
  for (const nodeId of appearsIn.get(characterId) ?? []) activeNodeIds.add(nodeId);
  for (const delta of listDeltasByTarget(ctx.db, characterId, ctx.outlineDir)) activeNodeIds.add(delta.nodeId);
  if (activeNodeIds.size === 0) return { active: false, lastChapter: null };

  let last: number | null = null;
  for (const nodeId of activeNodeIds) {
    const chapter = chapterIndex.chapterOf(nodeId);
    if (chapter !== null) {
      last = last === null ? chapter : Math.max(last, chapter);
    }
  }
  return { active: true, lastChapter: last };
}

/**
 * 闲置角色诊断（tools.md「写到第30章但角色C第10章后就没出现」）：
 * - 从未出场：无 appears_in 关系且无 Delta 记录
 * - 掉线角色：最后活跃章 < 当前最新章（「当前最新章」= current_position 所属章，
 *   决策 21 口径，经共享 ChapterIndex 推导——规划 40 章只写到 30 章时，活跃于第 35 章
 *   （未写章节）的角色不算闲置；大纲无章或角色活跃点无章号时不下结论——不做宽松猜测）
 * 输出按 id 升序（稳定排序，跨维度可预测）。
 */
function collectUnusedCharacters(ctx: ToolContext, signal?: AbortSignal): UnusedCharacter[] {
  const characters = listEntities(ctx.db, { type: "character", limit: 200 }).items;
  // appears_in（角色 → 大纲节点）按 sourceId 分组
  const appearsIn = new Map<string, string[]>();
  for (const r of listRelations(ctx.db, { sourceType: "character", relationType: "appears_in" }, 1, ctx.outlineDir).relations) {
    const list = appearsIn.get(r.sourceId) ?? [];
    list.push(r.targetId);
    appearsIn.set(r.sourceId, list);
  }
  const chapterIndex = buildChapterIndex(ctx); // 一次读树支撑全量活跃度查询
  const latestChapter = chapterIndex.currentChapter;

  const out: UnusedCharacter[] = [];
  for (const c of characters) {
    throwIfAborted(signal);
    const { active, lastChapter } = activityOf(ctx, chapterIndex, c.id, appearsIn);
    if (!active) {
      out.push({ id: c.id, name: c.name, lastActiveChapter: null, description: "从未出场（无 appears_in 关系且无属性变更记录）" });
      continue;
    }
    if (lastChapter !== null && latestChapter !== null && lastChapter < latestChapter) {
      out.push({
        id: c.id,
        name: c.name,
        lastActiveChapter: lastChapter,
        description: `最后活跃于第 ${lastChapter} 章（当前最新第 ${latestChapter} 章），已 ${latestChapter - lastChapter} 章未出场`,
      });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id)); // 稳定排序（输出可预测）
  return out;
}

/**
 * 孤立元素诊断（tools.md find_orphan_elements()，无参全项目扫描）。
 * 软删对象（回收站）不计入任何维度（listEntities/listRelations 过滤 + listDangling* 自身
 * 未软删的前提，决策 12）。signal：各维度循环中检查（决策 16 ③）。
 *
 * **inconsistent_soft_deletes 与 S4.2 启动一致性校验补标范围对齐**（server/consistency.ts，
 * 决策 16 修订——本工具诊断、S4.2 兜底修复，两侧口径必须一致）：
 * - S4.2 补标范围：relation 按端点（source_id/target_id 命中软删节点）、delta 按触发节点
 *   （node_id 命中软删节点）——对应本维度的 relation *_deleted 与 delta trigger_deleted
 * - **delta 的大纲 target（目标端点为大纲节点且已软删）不在 S4.2 补标范围**（补标不看
 *   target）——该形态归 unresolved_deltas（reason=target_deleted），不列为本维度；
 *   维护者不得将 target_deleted 移入本维度（否则与 S4.2 修复范围脱节）
 */
export function runFindOrphanElements(ctx: ToolContext, _args: FindOrphanElementsArgs, signal?: AbortSignal): OrphanElementsResult {
  // 1. 闲置角色
  const unusedCharacters = collectUnusedCharacters(ctx, signal);

  // 2-4. 悬空记录（db 诊断层：delta 自身/关系自身均未软删，只报不可见/悬空形态）
  const danglingDeltas = listDanglingDeltas(ctx.db, ctx.outlineDir);
  const danglingRelations = listDanglingRelations(ctx.db, ctx.outlineDir);
  throwIfAborted(signal);

  // 2. 未解决变更：触发节点缺失 / 目标端点软删或缺失（目标侧不可见）
  const unresolvedDeltas: UnresolvedDelta[] = [];
  // 3. 悬空关系：端点物理删除
  const danglingRelationList: DanglingRelation[] = [];
  // 4. 跨存储软删不一致：大纲节点已软删但记录未级联（trigger_deleted / *_deleted；
  //    口径见函数头注释——与 S4.2 补标范围对齐，delta 大纲 target 归 unresolved_deltas）
  const inconsistentSoftDeletes: InconsistentSoftDelete[] = [];

  for (const d of danglingDeltas) {
    throwIfAborted(signal);
    if (d.reason === "trigger_deleted") {
      inconsistentSoftDeletes.push({
        kind: "delta",
        recordId: d.id,
        nodeId: d.nodeId,
        endpointId: null,
        description: `Delta「${d.description}」的触发节点 ${d.nodeId} 已软删，但本记录未级联软删（跨存储不一致）`,
      });
    } else {
      unresolvedDeltas.push({
        id: d.id,
        nodeId: d.nodeId,
        targetType: d.targetType,
        targetId: d.targetId,
        description: d.description,
        reason: d.reason,
      });
    }
  }

  for (const r of danglingRelations) {
    throwIfAborted(signal);
    if (r.reason === "source_missing" || r.reason === "target_missing") {
      danglingRelationList.push({ id: r.id, sourceId: r.sourceId, targetId: r.targetId, relationType: r.relationType, reason: r.reason });
    } else {
      const endpointId = r.reason === "source_deleted" ? r.sourceId : r.targetId;
      inconsistentSoftDeletes.push({
        kind: "relation",
        recordId: r.id,
        nodeId: null,
        endpointId,
        description: `关系 ${r.sourceId} → ${r.targetId}（${r.relationType}）指向已软删端点 ${endpointId}，但本记录未级联软删（跨存储不一致）`,
      });
    }
  }
  inconsistentSoftDeletes.sort((a, b) => a.recordId.localeCompare(b.recordId)); // 稳定排序（输出可预测）

  return {
    unused_characters: unusedCharacters,
    unresolved_deltas: unresolvedDeltas,
    dangling_relations: danglingRelationList,
    inconsistent_soft_deletes: inconsistentSoftDeletes,
  };
}
