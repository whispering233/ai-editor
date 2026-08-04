// @whispering233/ai-editor-db 状态计算（S5.2 computeState）：沿大纲树父链累积 Delta 得到实体到达状态
//
// 单一事实来源：
// - doc/api/endpoints.md 第 464-510 行（POST /delta/compute：Req/Res、累积规则四段——
//   双层排序、set/update/add/remove 语义、update from 不匹配跳过 + conflicts、软删过滤）
// - 决策 9（只沿大纲树父链累积已确认 Delta、双层排序、op=update 校验当前值等于 from、
//   不匹配跳过 + skipped/conflicts 标注不返回 409、plot_edge 不参与、推演不落库）
// - doc/database/schema.md 第 107 行注记（状态计算规则摘要）
//
// 复用边界（不重复实现）：
// - listDeltasByNode（delta.ts）：按节点查询 + 可见性三态过滤（决策 12 修订：delta 自身 /
//   触发节点 / 目标实体任一软删即不可见）+ 节点内按 order 升序——computeState 的软删过滤
//   与「节点内 order 序」由此获得
// - getOutlinePathIds（storage/outline.ts）：根 → at_node 树路径（严格三层下路径唯一）；
//   节点不存在时抛错——视为调用方 bug 不捕获
// - getEntity（entity.ts）：目标实体行（data 已解析为对象）；不存在/已软删返回 null
//
// plot_edge 不参与（决策 9）：本实现只读 delta_records，relation_records 的剧情连线
// 天然不进入累积，无需额外过滤。

import type {
  AppliedDelta,
  AppliedDeltaSkippedChange,
  ComputeStateResult,
  DeltaChange,
  DeltaConflict,
} from "@whispering233/ai-editor-shared";
import type { Db } from "../connection.js";
import { listDeltasByNode } from "./delta.js";
import { getEntity } from "./entity.js";
import { getOutlinePathIds, readOutlineFile } from "../storage/outline.js";

/**
 * 应用单条 change 到 state（endpoints.md 第 500-510 行四段规则 + 决策 9 修订）：
 * - `set`：state[field] = to（直接替换）
 * - `update`：state[field] === from → state[field] = to；否则**跳过该 change**——
 *   在 skipped 追加 { index, field, expected: from, actual } 且 conflicts 追加
 *   { deltaId, field, expected: from, actual }（继续累积后续 change/delta，不抛 409——
 *   手动编辑 data 不产生 Delta 属正常用户行为）
 * - `add`：state[field] 为数组 → 按 value 追加；非数组**静默跳过**（防御，不标 conflicts——
 *   契约仅定义 update 冲突）
 * - `remove`：state[field] 为数组 → 按值匹配移除**首个**匹配；值不存在静默忽略；
 *   非数组静默跳过
 * 字段约定（endpoints.md 第 407-413 行）：add/remove 用 value，set/update 用 to。
 * 防御：非对象 change 静默忽略（changes 列来自 JSON 解析，坏项不打挂整条计算）。
 */
function applyChange(
  state: Record<string, unknown>,
  change: DeltaChange,
  index: number,
  deltaId: string,
  skipped: AppliedDeltaSkippedChange[],
  conflicts: DeltaConflict[],
): void {
  if (change === null || typeof change !== "object") return;
  const { field, op } = change;
  switch (op) {
    case "set": // set：直接替换（to）
      state[field] = change.to;
      break;
    case "update": // update：旧值 → 新值，校验当前值 === from
      if (state[field] === change.from) {
        state[field] = change.to;
      } else {
        const actual = state[field];
        skipped.push({ index, field, expected: change.from, actual });
        conflicts.push({ deltaId, field, expected: change.from, actual });
      }
      break;
    case "add": // add：按 value 向数组追加（非数组静默跳过）
      if (Array.isArray(state[field])) {
        (state[field] as unknown[]).push(change.value);
      }
      break;
    case "remove": // remove：按值匹配移除首个（值不存在静默忽略；非数组静默跳过）
      if (Array.isArray(state[field])) {
        const arr = state[field] as unknown[];
        const idx = arr.findIndex((v) => v === change.value);
        if (idx !== -1) arr.splice(idx, 1);
      }
      break;
  }
}

/**
 * 计算实体到达指定大纲节点时的累积状态（POST /api/v1/delta/compute，endpoints.md 第 464-510 行）。
 *
 * **前置约定**：
 * - atNodeId 必须存在——路由层先校验节点存在性并映射 404 OUTLINE_NODE_NOT_FOUND 后调用；
 *   getOutlinePathIds 对缺失节点抛错，视为调用方 bug，本模块不捕获。
 * - 目标实体不存在（或已软删，getEntity 过滤）→ 返回 **null**，路由层映射 404 ENTITY_NOT_FOUND。
 *
 * 累积流程（决策 9 + schema.md 第 107 行）：
 * 1. state 基座 = 实体初始 data 深拷贝（structuredClone，不污染 getEntity 返回行）
 * 2. 树路径 = getOutlinePathIds(tree, atNodeId)（根 → at_node，含 root 哨兵——无 delta 挂它，
 *    无害）；路径上每节点调 listDeltasByNode（内置可见性三态过滤与 order ASC），
 *    过滤 target_id === targetId——天然满足「节点间树路径序 + 节点内 order 序」双层排序
 *    与软删过滤
 * 3. 逐 change 应用（applyChange，决策 9 修订四段语义）；update 冲突跳过不打断后续累积
 * 4. 响应：appliedDeltas 每项 { nodeId, description, changes（原样数组）, skipped?（仅该 delta
 *    有跳过时出现）}；conflicts 为跨全部 delta 的扁平数组
 *
 * target_type 不参与过滤（仅回显）：id 前缀体系（char-/set-/loc-/hook-/sc-/ch-/vol- 等）保证
 * target_id 全局唯一，targetId 即足以定位目标；endpoints.md Req 携带 target_type 用于响应回显。
 *
 * @param outlineDir 项目根目录（outline.json 读取：树路径 + 节点软删校验）
 * @returns ComputeStateResult；目标实体不存在/已软删返回 null
 */
export function computeState(
  db: Db,
  outlineDir: string,
  input: { targetType: string; targetId: string; atNodeId: string },
): ComputeStateResult | null {
  // 1. 目标实体：不存在或已软删 → null（决策 12 过滤；路由层映射 404 ENTITY_NOT_FOUND）
  const entity = getEntity(db, input.targetId);
  if (entity === null) return null;

  // 2. 树路径（根 → at_node；缺失节点抛错——路由层前置校验后的调用方 bug，不捕获）
  const tree = readOutlineFile(outlineDir);
  const path = getOutlinePathIds(tree, input.atNodeId);

  // 3. state 基座：初始 data 深拷贝（每次计算独立，不污染实体行）
  const state: Record<string, unknown> = structuredClone(entity.data);

  const appliedDeltas: AppliedDelta[] = [];
  const conflicts: DeltaConflict[] = [];

  // 4. 双层排序累积：节点间按路径序（根 → at_node），节点内按 order ASC（listDeltasByNode）
  for (const nodeId of path) {
    for (const delta of listDeltasByNode(db, nodeId, outlineDir)) {
      if (delta.targetId !== input.targetId) continue; // 只取目标实体的 Delta
      const skipped: AppliedDeltaSkippedChange[] = [];
      const changes = delta.changes;
      for (let i = 0; i < changes.length; i++) {
        applyChange(state, changes[i], i, delta.id, skipped, conflicts);
      }
      const applied: AppliedDelta = {
        nodeId: delta.nodeId,
        description: delta.description,
        changes, // 原样 changes 数组（本模块不修改，可安全共享引用）
      };
      if (skipped.length > 0) applied.skipped = skipped; // 仅该 delta 有跳过时出现
      appliedDeltas.push(applied);
    }
  }

  return {
    targetType: input.targetType,
    targetId: input.targetId,
    atNodeId: input.atNodeId,
    state,
    appliedDeltas,
    conflicts,
  };
}
