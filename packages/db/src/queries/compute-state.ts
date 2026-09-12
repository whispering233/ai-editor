// @whispering233/ai-editor-db 状态计算（S5.2 computeState）：按**章序前缀**累积 Delta 得到实体到达状态
//
// 累积口径（2026-09 修订，见 docs/design/10-data-model.md §4）：
// 状态 = 实体初始 data + 「章序 ≤ 目标进度章」的全部已确认 Delta（跨卷/跨章累积），
// 按（章序 ASC, 章节内 order ASC）双层排序应用。旧口径「只沿大纲树父链」在锚点仅章
// （卡片 1.2）后失效——严格三层下父链至多含一个章，兄弟章的 Delta 不可见。
//
// 复用边界（不重复实现）：
// - listDeltasByNode（delta.ts）：按节点查询 + 可见性三态过滤（delta 自身 /
// 触发节点 / 目标实体任一软删即不可见）+ 节点内按 order 升序——computeState 的软删过滤
// 与「章节内 order 序」由此获得
// - deriveChapterOrder（outline-ops.ts）：全局章序（先序遍历、跨卷连续累计）——前缀边界与
// 应用序由此获得
// - getOutlinePathIds（storage/outline.ts）：根 → at_node 树路径（场景 → 所属章的映射 +
// 节点缺失时抛错——视为调用方 bug 不捕获）
// - getEntity（entity.ts）：目标实体行（data 已解析为对象）；不存在/已软删返回 null
//
// plot_edge 不参与：本实现只读 delta_records，relation_records 的剧情连线
// 天然不进入累积，无需额外过滤。
//
// 已知代价（登记在案）：appliedDeltas 随写作进度增长（含前面所有章的 Delta），
// 由上层截断机制兜底——本模块不新增截断。

import type {
  AppliedDelta,
  AppliedDeltaSkippedChange,
  ComputeStateResult,
  DeltaChange,
  DeltaConflict,
  OutlineFileTree,
} from "@whispering233/ai-editor-shared";
import type { Db } from "../connection.js";
import { listDeltasByNode } from "./delta.js";
import { getEntity } from "./entity.js";
import { deriveChapterOrder, type ChapterOrderInfo } from "./outline-ops.js";
import { findOutlineNode, getOutlinePathIds, readOutlineFile } from "../storage/outline.js";

/**
 * 应用单条 change 到 state（四段规则 +）：
 * - `set`：state[field] = to（直接替换）
 * - `update`：state[field] === from → state[field] = to；否则**跳过该 change**——
 * 在 skipped 追加 { index, field, expected: from, actual } 且 conflicts 追加
 * { deltaId, field, expected: from, actual }（继续累积后续 change/delta，不抛 409——
 * 手动编辑 data 不产生 Delta 属正常用户行为）
 * - `add`：state[field] 为数组 → 按 value 追加；非数组**静默跳过**（防御，不标 conflicts——
 * 仅定义 update 冲突）
 * - `remove`：state[field] 为数组 → 按值匹配移除**首个**匹配；值不存在静默忽略；
 * 非数组静默跳过
 * 字段约定：add/remove 用 value，set/update 用 to。
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
 * 目标节点 → **进度章序**（0 = 尚未进入任何章：root / 无章的卷）：
 * - `chapter` → 自身章序；
 * - `scene` → 沿路径向上最近的 `chapter` 祖先（严格三层下即其父）；
 * - `volume` → 该卷**最后一个未软删章**（无章 → 0，表示该卷尚无写作进度）；
 * - `root` / 未知 → 0。
 * 防御：节点缺失返回 0（路由层已前置校验存在性，且 getOutlinePathIds 先行抛错）。
 */
function resolveProgressChapterNumber(
  tree: OutlineFileTree,
  path: readonly string[],
  order: readonly ChapterOrderInfo[],
  atNodeId: string,
): number {
  const node = findOutlineNode(tree, atNodeId);
  if (node === undefined) return 0;
  const numberOf = (chapterId: string): number =>
    order.find((c) => c.chapterId === chapterId)?.chapterNumber ?? 0;
  switch (node.type) {
    case "chapter":
      return numberOf(node.id);
    case "scene":
 // 路径 = [root, (vol), (ch), scene]——从末段前一项回溯找章（章直挂 root 时同样命中）
      for (let i = path.length - 2; i >= 0; i--) {
        const ancestor = path[i];
        if (findOutlineNode(tree, ancestor)?.type === "chapter") return numberOf(ancestor);
      }
      return 0; // 防御：无章祖先（严格三层下不可达）
    case "volume": {
      const chapters = (node.children ?? []).filter((c) => c.type === "chapter" && c.deleted !== true);
      const last = chapters[chapters.length - 1];
      return last === undefined ? 0 : numberOf(last.id);
    }
    default:
      return 0; // root：只返回初始值
  }
}

/**
 * 计算实体到达指定大纲节点时的累积状态（POST /api/v1/delta/compute）。
 *
 * **前置约定**：
 * - atNodeId 必须存在——路由层先校验节点存在性并映射 404 OUTLINE_NODE_NOT_FOUND 后调用；
 * getOutlinePathIds 对缺失节点抛错，视为调用方 bug，本模块不捕获。
 * - 目标实体不存在（或已软删，getEntity 过滤）→ 返回 **null**，路由层映射 404 ENTITY_NOT_FOUND。
 *
 * 累积流程（章序前缀累积，2026-09 修订）：
 * 1. state 基座 = 实体初始 data 深拷贝（structuredClone，不污染 getEntity 返回行）
 * 2. 树路径 = getOutlinePathIds(tree, atNodeId)——用于目标节点 → 进度章的映射
 * （同时保留「节点不存在抛错」语义）；全局章序 = deriveChapterOrder(outlineDir)
 * 3. 收集范围 = **章序 ≤ 进度章序**的全部章（跨卷/跨章），按（章序 ASC, 章内 order ASC）
 * 逐章调 listDeltasByNode（内置可见性三态过滤与 order ASC），过滤 target_id === targetId
 * ——天然满足双层排序与软删过滤；场景/卷/root 上的存量 Delta 不参与（锚点仅章）
 * 4. 逐 change 应用（applyChange，四段语义）；update 冲突跳过不打断后续累积
 * 5. 响应：appliedDeltas 每项 { nodeId, description, changes（原样数组）, skipped?（仅该 delta
 * 有跳过时出现）}；conflicts 为跨全部 delta 的扁平数组
 *
 * target_type 不参与过滤（仅回显）：id 前缀体系（char-/set-/loc-/hook-/sc-/ch-/vol- 等）保证
 * target_id 全局唯一，targetId 即足以定位目标；Req 携带 target_type 用于响应回显。
 *
 * @param outlineDir 项目根目录（outline.json 读取：树路径/章序推导 + 节点软删校验）
 * @returns ComputeStateResult；目标实体不存在/已软删返回 null
 */
export function computeState(
  db: Db,
  outlineDir: string,
  input: { targetType: string; targetId: string; atNodeId: string },
): ComputeStateResult | null {
 // 1. 目标实体：不存在或已软删 → null（路由层映射 404 ENTITY_NOT_FOUND）
  const entity = getEntity(db, input.targetId);
  if (entity === null) return null;

 // 2. 树路径（根 → at_node；缺失节点抛错——路由层前置校验后的调用方 bug，不捕获）
  const tree = readOutlineFile(outlineDir);
  const path = getOutlinePathIds(tree, input.atNodeId);

 // 3. state 基座：初始 data 深拷贝（每次计算独立，不污染实体行）
  const state: Record<string, unknown> = structuredClone(entity.data);

  const appliedDeltas: AppliedDelta[] = [];
  const conflicts: DeltaConflict[] = [];

 // 4. 章序前缀（deriveChapterOrder 已是先序升序，filter 保持升序）→ 逐章按 order ASC 累积
  const chapterOrder = deriveChapterOrder(outlineDir);
  const progressChapter = resolveProgressChapterNumber(tree, path, chapterOrder, input.atNodeId);
  for (const chapter of chapterOrder) {
    if (chapter.chapterNumber > progressChapter) break; // 升序 → 首个越界即结束
    for (const delta of listDeltasByNode(db, chapter.chapterId, outlineDir)) {
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
