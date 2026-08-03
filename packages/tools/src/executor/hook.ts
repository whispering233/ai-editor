// 执行类工具：伏笔生命周期复合写（S6.7，tools.md「执行类」3 个）
// advance_hook / resolve_hook / abandon_hook
//
// **复合写（2026-08 修订，tools.md「复合写说明」）**：确认后封装「delta 插入 + relation 插入」
// 两步写为**一次提交**（withTransaction），失败整体回滚、不产生半状态。
// - advance_hook：delta_records 记 status → progressing + relation_records 插 advances
// - resolve_hook：delta_records 记 status → resolved + relation_records 插 resolves
// - abandon_hook：仅 delta_records 记 status → abandoned（tools.md：无 relation；args 无 node_id）
//
// **幂等**：先查 (node_id, hook_id, relation_type) 是否已有未软删记录，存在即返回已有 id
// （不重复写）——重复确认/重复提案均不重复推进；abandon 无关系可查，改查「已记
// status=abandoned 的 delta」（同语义：不重复写废弃记录；**JSON 解析精确判定**，见
// findExistingStatusDeltaId——避免 LIKE 误命中其他字段的 to=abandoned）。
// **边界**：advance/resolve 幂等只查关系记录，不查 delta——关系被**手动物理删**（决策 12：
// 手动删关系不走回收站、物理删）后重复确认会再写一条 delta + relation（幂等失效但语义
// 自洽：关系已不存在，重写即恢复；delta 的 from 取当前 data.status，链条不破）。
//
// 变更形态（hooks.md「伏笔状态变化」）：changes = [{ field: "status", op: "update",
// from: 当前状态, to: 目标状态 }]——from 取 hook.data.status（缺省 planted，决策 21 口径：
// 状态缺失视为 planted），保证 computeState 的 update 校验（决策 9）正常累积；
// description 取 proposal.args.description（delta_records.description NOT NULL）。
// 终态守卫：resolved/abandoned 为生命周期终态（hooks.md），终态伏笔不可再推进/回收/废弃。
//
// **状态同步（S6.7 修复轮必须改）**：复合写事务内插入 delta 后**同步更新
// entities.data.status**（浅合并 + 刷新 updated_at，与决策 14 快照比对语义兼容）——
// 终态守卫（assertNotTerminal）、delta 的 from（currentHookStatus）与 S6.5 hookStatuses
// （analysis/hook.ts collectHooks 读 entity.data.status）均以 data.status 为唯一事实来源
// （决策 21 口径）；不同步则 resolved/abandoned 后仍可推进、同 hook 二次推进 from 断裂
// （computeState conflicts）、已回收伏笔仍计 active。**幂等命中路径不更新**（首次执行已同步）。
//
// 执行类是短同步事务，不做 signal 检查（决策 16 ③：长工具才要求执行中检查；入口检查由
// S7.5 确认路由承担）。

import { createRelation, findOutlineNode, insertDelta, readOutlineFile, readProjectFile, updateEntity, withTransaction, type Db } from "@ai-editor/db";
import type { DeltaChange } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { requireHook, requireOutlineNode } from "../proposal/types.js";
import { requireString, type ExecutorFn, type ExecutorResult } from "./types.js";

/** 伏笔生命周期终态（hooks.md：planted → progressing → resolved 或 abandoned） */
const TERMINAL_STATUSES = ["resolved", "abandoned"] as const;

/** 取伏笔当前状态（data.status 缺失/空串 → planted——创建即埋设，决策 21 口径） */
function currentHookStatus(hook: { data: Record<string, unknown> }): string {
  const status = hook.data.status;
  return typeof status === "string" && status !== "" ? status : "planted";
}

/** 终态守卫：终态伏笔不可再推进/回收/废弃（生命周期语义，hooks.md） */
function assertNotTerminal(hook: { data: Record<string, unknown> }, actionLabel: string): void {
  const status = currentHookStatus(hook);
  if ((TERMINAL_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`伏笔已处于终态 ${status}，无法${actionLabel}`);
  }
}

/**
 * 幂等查询（advance/resolve）：同 (node_id, hook_id, relation_type) 已有**未软删**记录
 * → 返回其 id（tools.md 复合写说明：重复确认/重复提案均不重复推进；含端点软删后还原的
 * 记录——deleted_at 置 NULL 后仍命中）。
 */
function findExistingLifecycleRelation(db: Db, nodeId: string, hookId: string, relationType: string): string | null {
  const row = db
    .prepare(
      "SELECT id FROM relation_records WHERE source_id = ? AND target_id = ? AND relation_type = ? AND deleted_at IS NULL",
    )
    .get(nodeId, hookId, relationType) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * 幂等查询（abandon）：已存在记 status=abandoned 的未软删 delta → 返回其 id
 * （abandon 无 node_id/关系可查，改按 delta 内容判重——同「不重复写」语义）。
 * changes 列为 JSON 字符串，**逐行 JSON 解析精确判定**（S6.7 修复轮：不用 LIKE 文本
 * 形态——`%"to":"abandoned"%` 会误命中任意字段的该值，如 {field:"category", to:"abandoned"}）：
 * 任一 change 为 { field: "status", to: toStatus } 即命中（新写 delta 必带该形态）；
 * 坏 JSON 行跳过（脏数据防御）。取最新一条（order DESC，与原 LIMIT 1 语义一致）。
 */
function findExistingStatusDeltaId(db: Db, hookId: string, toStatus: string): string | null {
  const rows = db
    .prepare('SELECT id, changes FROM delta_records WHERE target_id = ? AND deleted_at IS NULL ORDER BY "order" DESC')
    .all(hookId) as Array<{ id: string; changes: string }>;
  for (const row of rows) {
    let changes: unknown;
    try {
      changes = JSON.parse(row.changes);
    } catch {
      continue; // 坏 JSON：跳过该行继续查（不误判）
    }
    const hit = Array.isArray(changes) && changes.some((c) => {
      if (c === null || typeof c !== "object") return false;
      const change = c as Record<string, unknown>;
      return change.field === "status" && change.to === toStatus;
    });
    if (hit) return row.id;
  }
  return null;
}

/**
 * abandon 的 delta 锚定节点：废弃是主动放弃（无指定节点，propose_abandon_hook 仅 hook_id +
 * description）——取 project.json current_position（决策 21「当前章节」锚点，存在且未软删）；
 * 未设置/失效则退化取树末节点（当前写作进度末端）；大纲空树 → 抛错（无锚点不可记录）。
 */
function anchorNodeForAbandon(ctx: ToolContext): string {
  const config = readProjectFile(ctx.outlineDir);
  if (config !== null && config.current_position !== null && config.current_position !== "") {
    const node = findOutlineNode(readOutlineFile(ctx.outlineDir), config.current_position);
    if (node !== undefined && node.deleted !== true) return config.current_position;
  }
  const tree = readOutlineFile(ctx.outlineDir);
  // 树末节点：先序遍历最后一个叶子（卷→章→场景的最深最后节点）
  let last: string | null = null;
  const visit = (node: { id: string; deleted?: boolean; children?: unknown[] }): void => {
    if (node.deleted === true) return;
    last = node.id;
    const kids = node.children;
    if (kids !== undefined) {
      for (const kid of kids) visit(kid as { id: string; deleted?: boolean; children?: unknown[] });
    }
  };
  for (const child of tree.children) visit(child);
  if (last === null) {
    throw new Error("大纲无可用节点，无法记录伏笔废弃位置");
  }
  return last;
}

/**
 * 复合写公共骨架（advance/resolve/abandon 共用）：
 * 幂等判重 → 校验（伏笔/节点存在且未软删 + 终态守卫）→ delta 插入 → relation 插入，
 * **withTransaction 一次提交**——任一步抛错整体回滚（失败不产生半状态）。
 * @param relationType advance/resolve 插入的关系类型；abandon 传 null（无关系）
 * @param toStatus delta 记入的目标状态（progressing/resolved/abandoned）
 */
function executeHookTransition(
  ctx: ToolContext,
  proposal: Parameters<ExecutorFn>[1],
  relationType: "advances" | "resolves" | null,
  toStatus: string,
  actionLabel: string,
): ExecutorResult {
  const args = proposal.args;
  const hookId = requireString(args, "hook_id");
  const nodeId = relationType === null ? null : requireString(args, "node_id");
  const description = requireString(args, "description"); // delta_records.description NOT NULL（tools.md）
  return withTransaction(ctx.db, () => {
    // 幂等（含未软删记录）：命中即返回已有 id，不重复写
    if (relationType !== null) {
      const existing = findExistingLifecycleRelation(ctx.db, nodeId!, hookId, relationType);
      if (existing !== null) return { id: existing, duplicated: true };
    } else {
      const existing = findExistingStatusDeltaId(ctx.db, hookId, toStatus);
      if (existing !== null) return { id: existing, duplicated: true };
    }
    // 校验：伏笔存在且 type=hook；推进/回收节点存在且未软删（决策 12）
    const hook = requireHook(ctx, hookId);
    if (nodeId !== null) requireOutlineNode(ctx, nodeId);
    // 终态守卫（resolved/abandoned 不可再推进/回收；废弃时不可再废弃）
    assertNotTerminal(hook, actionLabel);
    // delta：记 status 变化（from=当前状态，决策 9 update 语义，computeState 正常累积）
    const changes: DeltaChange[] = [{ field: "status", op: "update", from: currentHookStatus(hook), to: toStatus }];
    const delta = insertDelta(ctx.db, {
      nodeId: nodeId ?? anchorNodeForAbandon(ctx),
      targetType: "hook",
      targetId: hookId,
      changes,
      description,
    });
    // **状态同步（S6.7 修复轮必须改）**：同一事务内浅合并更新 entities.data.status
    // （updateEntity 内部 withTransaction → 嵌套自动升级 SAVEPOINT，整体仍一次提交）：
    // 终态守卫 / delta 的 from / S6.5 hookStatuses 均读 data.status——不落地则 resolved 后
    // 仍可推进（守卫失效）、同 hook 二次推进 from 断裂（computeState conflicts）、
    // 已回收伏笔仍计 active。幂等命中路径（上方 early return）不更新——首次执行已同步。
    updateEntity(ctx.db, hookId, { data: { status: toStatus } });
    // relation：advances / resolves（大纲节点 → hook；hooks.md 方向约定）
    if (relationType !== null) {
      const relation = createRelation(
        ctx.db,
        { sourceType: "outline_node", sourceId: nodeId!, targetType: "hook", targetId: hookId, relationType },
        ctx.outlineDir,
      );
      return { id: relation.id };
    }
    return { id: delta.id };
  });
}

/** advance_hook（tools.md：advance_hook(hook_id, node_id, description) → id） */
export const executeAdvanceHook: ExecutorFn = (ctx, proposal) =>
  executeHookTransition(ctx, proposal, "advances", "progressing", "推进");

/** resolve_hook（tools.md：resolve_hook(hook_id, node_id, description) → id） */
export const executeResolveHook: ExecutorFn = (ctx, proposal) =>
  executeHookTransition(ctx, proposal, "resolves", "resolved", "回收");

/** abandon_hook（tools.md：abandon_hook(hook_id, description) → id；仅 delta 记 status=abandoned） */
export const executeAbandonHook: ExecutorFn = (ctx, proposal) =>
  executeHookTransition(ctx, proposal, null, "abandoned", "废弃");
