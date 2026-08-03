// @ai-editor/db 大纲树操作（S2.1）：创建/更新/移动/软删/还原/物理删除/回收站列表/章节序
//
// 单一事实来源：
// - doc/design/decisions.md 决策 19（严格三层：volume 挂 root、chapter 挂 volume 或 root、
//   scene 必须挂 chapter；创建必须显式 parent_id；无游离节点；节点 updated_at 版本戳）、
//   决策 12（软删 deleted/deleted_at、级联软删子树、restore 祖先链校验 409）、
//   决策 21（章节序：root → 卷 → 章先序遍历，全局章序号跨卷连续，scene 归入所属章）
// - doc/api/endpoints.md 第 550-736 行（大纲操作与回收站端点语义）
// - doc/database/schema.md 第 123-155 行（outline.json 契约）
//
// 风格：本模块为「读树 → 操作 → 原子写回」一体化（dir 语义），内部复用 storage/outline.ts
// 的内存操作（readOutlineFile/writeOutlineFile/findOutlineNode/touch/update/getOutlinePathIds）；
// relations/deltas 的级联软删由上层（S2.2 路由层）组合 relation/delta 模块完成——本模块
// 只处理 outline.json 侧（任务卡边界）。
//
// 错误约定：抛 OutlineError（带 code），server 层 catch 映射 HttpError：
//   NODE_NOT_FOUND             → 404 OUTLINE_NODE_NOT_FOUND
//   PARENT_NOT_FOUND           → 400 OUTLINE_NODE_NOT_FOUND（父不存在是请求参数错误——
//                                S2.2 实际映射为 400，2026-08 审核同步注释）
//   INVALID_HIERARCHY          → 400 VALIDATION_ERROR（严格三层违反，决策 19）
//   OUTLINE_ANCESTOR_DELETED   → 409 OUTLINE_ANCESTOR_DELETED（决策 12 修订）

import type { OutlineFileNode, OutlineFileTree, OutlineNodeType } from "@ai-editor/shared";
import { generateOutlineNodeId } from "@ai-editor/shared";
import {
  findOutlineNode,
  getOutlinePathIds,
  readOutlineFile,
  writeOutlineFile,
} from "../storage/outline.js";

/** 大纲操作错误码（server 层映射 HttpError，见文件头注释） */
export type OutlineErrorCode =
  | "NODE_NOT_FOUND"
  | "PARENT_NOT_FOUND"
  | "INVALID_HIERARCHY"
  | "OUTLINE_ANCESTOR_DELETED";

/** 大纲操作错误：带 code，供上层精确映射 HTTP 语义（替代 message 字符串匹配） */
export class OutlineError extends Error {
  readonly code: OutlineErrorCode;
  constructor(code: OutlineErrorCode, message: string) {
    super(message);
    this.name = "OutlineError";
    this.code = code;
  }
}

/** 取节点 children 的可变引用（卷→章、章→场景；场景返回 undefined） */
function childrenOf(node: OutlineFileTree | OutlineFileNode): OutlineFileNode[] | undefined {
  return (node as { children?: OutlineFileNode[] }).children;
}

/**
 * 严格三层约束校验（决策 19）：childType 能否挂 parentType 下。
 * volume → root；chapter → volume 或 root；scene → 必须 chapter。
 */
export function assertCanHold(parentType: "root" | OutlineNodeType, childType: OutlineNodeType): void {
  const ok =
    (parentType === "root" && (childType === "volume" || childType === "chapter")) ||
    (parentType === "volume" && childType === "chapter") ||
    (parentType === "chapter" && childType === "scene");
  if (!ok) {
    throw new OutlineError(
      "INVALID_HIERARCHY",
      `层级非法（决策 19 严格三层）: ${childType} 不能挂在 ${parentType} 下`,
    );
  }
}

/**
 * 创建大纲节点（POST /api/v1/outline，endpoints.md 第 550-577 行）：
 * 读树 → 校验父存在 + 三层约束 → 生成 id（shared generateOutlineNodeId：vol-/ch-/sc- 前缀）
 * → 插入父 children 尾部 → **父节点 updated_at 统一更新**（决策 19）→ 原子写回。
 *
 * @param updatedAt ISO 8601 由调用方（应用层）传入，模块不生成时间
 * @param data 节点结构化信息（决策 23，可选；校验由路由层按层级 schema 执行，本模块仅透传存储）
 * @returns 新建节点（含 id/type/title/updated_at/data）
 * @throws OutlineError PARENT_NOT_FOUND（父不存在）/ INVALID_HIERARCHY（三层违反）
 */
export function createOutlineNode(
  dir: string,
  input: {
    type: Exclude<OutlineNodeType, "root">;
    title: string;
    parentId: string;
    summary?: string;
    data?: Record<string, unknown>;
    updatedAt: string;
  },
): OutlineFileNode {
  const tree = readOutlineFile(dir);
  const parent = input.parentId === "root" ? tree : findOutlineNode(tree, input.parentId);
  if (parent === undefined) {
    throw new OutlineError("PARENT_NOT_FOUND", `父节点不存在: ${input.parentId}`);
  }
  assertCanHold(parent.type, input.type);

  const node = {
    id: generateOutlineNodeId(input.type),
    type: input.type,
    title: input.title,
    updated_at: input.updatedAt,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
    // 非 scene 节点必须初始化 children 数组（volume→chapter[]、chapter→scene[]），
    // 否则 childrenOf 视为叶子、后续挂载失败
    ...(input.type !== "scene" ? { children: [] } : {}),
  } as OutlineFileNode;
  const kids = childrenOf(parent);
  if (kids === undefined) {
    throw new OutlineError("INVALID_HIERARCHY", `父节点是叶子（scene），无法挂子节点: ${input.parentId}`);
  }
  kids.push(node);
  // 父节点版本戳（决策 19：children 变更由服务端原子写时统一更新）。
  // root 是树根非节点（schema.md 顶层契约仅 id/type/schema_version/children），
  // 不写 updated_at——版本戳只适用于节点（oracle 审核修复）
  if (parent !== tree) {
    (parent as OutlineFileNode).updated_at = input.updatedAt;
  }
  writeOutlineFile(dir, tree);
  return node;
}

/**
 * 更新大纲节点信息（PUT /api/v1/outline/:nodeId，endpoints.md 第 579-597 行）：
 * title/summary 更新 + 节点 updated_at 统一更新（决策 19），原子写回；
 * data **浅合并**（决策 23：未传字段保留，与实体 updateEntity 的 data 浅合并同语义）。
 * @throws OutlineError NODE_NOT_FOUND
 */
export function updateOutlineNodeInfo(
  dir: string,
  nodeId: string,
  patch: { title?: string; summary?: string; data?: Record<string, unknown> },
  updatedAt: string,
): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  if (patch.title !== undefined) node.title = patch.title;
  if (patch.summary !== undefined) node.summary = patch.summary;
  // data 浅合并：仅合并传入字段，现有字段保留（决策 23；与 updateEntity 同语义）
  if (patch.data !== undefined) {
    node.data = { ...(node.data ?? {}), ...patch.data };
  }
  node.updated_at = updatedAt;
  writeOutlineFile(dir, tree);
}

/** 在树中找 nodeId 的直接父（返回树根或节点引用）；不在树中返回 undefined */
function findParentOf(tree: OutlineFileTree, nodeId: string): OutlineFileTree | OutlineFileNode | undefined {
  for (const child of tree.children) {
    if (child.id === nodeId) return tree;
    const found = findParentRecursive(child, nodeId);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findParentRecursive(
  node: OutlineFileNode,
  nodeId: string,
): OutlineFileNode | undefined {
  for (const child of childrenOf(node) ?? []) {
    if (child.id === nodeId) return node;
    const found = findParentRecursive(child, nodeId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 移动大纲节点（PUT /api/v1/outline/:nodeId/move，endpoints.md 第 599-621 行）：
 * 从原父移除 → 插入新父指定 order（0-based；同父重排 = 移除后插入）→
 * 三层约束校验（同 create）→ 新旧父 updated_at 统一更新（决策 19）→ 原子写回。
 * order 越界时 clamp 到有效范围（拖拽场景边界值，宽松处理）。
 *
 * @returns { previousParentId, newParentId }（endpoints.md 语义；root 用 "root"）
 * @throws OutlineError NODE_NOT_FOUND / PARENT_NOT_FOUND / INVALID_HIERARCHY
 */
export function moveOutlineNode(
  dir: string,
  nodeId: string,
  input: { parentId: string; order: number },
  updatedAt: string,
): { previousParentId: string; newParentId: string } {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  const prevParent = findParentOf(tree, nodeId);
  if (prevParent === undefined) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  const newParent = input.parentId === "root" ? tree : findOutlineNode(tree, input.parentId);
  if (newParent === undefined) {
    throw new OutlineError("PARENT_NOT_FOUND", `父节点不存在: ${input.parentId}`);
  }
  assertCanHold(newParent.type, node.type);

  // 从原父移除
  const prevKids = childrenOf(prevParent);
  const idx = prevKids?.indexOf(node) ?? -1;
  if (idx < 0) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不在父节点 children 中: ${nodeId}`);
  }
  prevKids!.splice(idx, 1);

  // 插入新父指定位置（order clamp 到 [0, len]）
  const newKids = childrenOf(newParent);
  if (newKids === undefined) {
    throw new OutlineError("INVALID_HIERARCHY", `新父节点是叶子（scene）: ${input.parentId}`);
  }
  const order = Math.max(0, Math.min(Math.trunc(input.order), newKids.length));
  newKids.splice(order, 0, node);

  // 新旧父版本戳（决策 19）；同父时只更新一次。
  // root 是树根非节点，不写 updated_at（schema.md 顶层契约，oracle 审核修复）
  if (prevParent !== tree) {
    (prevParent as OutlineFileNode).updated_at = updatedAt;
  }
  if (newParent !== prevParent && newParent !== tree) {
    (newParent as OutlineFileNode).updated_at = updatedAt;
  }
  writeOutlineFile(dir, tree);
  return {
    previousParentId: prevParent.type === "root" ? "root" : prevParent.id,
    newParentId: newParent.type === "root" ? "root" : newParent.id,
  };
}

/** 递归软删子树（决策 12 级联）：标记 deleted + deleted_at + updated_at，返回子节点数 */
function softDeleteSubtree(node: OutlineFileNode, deletedAt: string): number {
  let count = 0;
  for (const child of childrenOf(node) ?? []) {
    count += 1 + softDeleteSubtree(child, deletedAt);
    child.deleted = true;
    child.deleted_at = deletedAt;
    child.updated_at = deletedAt;
  }
  return count;
}

/**
 * 软删大纲节点（DELETE /api/v1/outline/:nodeId，endpoints.md 第 623-640 行，决策 12）：
 * 标记 deleted + deleted_at，**递归软删整棵子树**（本体保留可还原）。
 * 已软删节点再次软删：幂等重标（不报错）。
 *
 * @returns { children } 级联软删的子节点数（不含自身）
 *   —— relations/deltas 的级联软删由上层（S2.2）组合 relation/delta 模块处理（本模块边界）
 * @throws OutlineError NODE_NOT_FOUND
 */
export function deleteOutlineNode(dir: string, nodeId: string, updatedAt: string): { children: number } {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  const children = softDeleteSubtree(node, updatedAt);
  node.deleted = true;
  node.deleted_at = updatedAt;
  node.updated_at = updatedAt;
  writeOutlineFile(dir, tree);
  return { children };
}

/** 递归还原子树（决策 12 修订：子节点若仍在回收站则一并还原），返回还原的子节点数 */
function restoreSubtree(node: OutlineFileNode, updatedAt: string): number {
  let count = 0;
  for (const child of childrenOf(node) ?? []) {
    count += 1 + restoreSubtree(child, updatedAt);
    delete child.deleted;
    delete child.deleted_at;
    child.updated_at = updatedAt;
  }
  return count;
}

/**
 * 还原软删大纲节点（POST /api/v1/trash/outline/:nodeId/restore，endpoints.md 第 694-711 行）：
 * 清除 deleted/deleted_at → **递归还原子树**（仍软删的子孙一并还原，决策 12 修订）→
 * **祖先链校验**：存在软删祖先 → 抛 OUTLINE_ANCESTOR_DELETED（409 语义，决策 12 修订，
 * 杜绝「可见节点挂在不可见父」的畸形树——校验在还原前执行，祖先必须已还原）。
 *
 * @returns { children } 级联还原的子节点数
 * @throws OutlineError NODE_NOT_FOUND / OUTLINE_ANCESTOR_DELETED
 */
export function restoreOutlineNode(dir: string, nodeId: string, updatedAt: string): { children: number } {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  if (node === undefined) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  // 祖先链校验（决策 12 修订）：路径 [root, ..., nodeId] 中排除 root 与自身的中间祖先
  const path = getOutlinePathIds(tree, nodeId);
  for (const ancestorId of path.slice(1, -1)) {
    const ancestor = findOutlineNode(tree, ancestorId);
    if (ancestor?.deleted === true) {
      throw new OutlineError(
        "OUTLINE_ANCESTOR_DELETED",
        `存在软删祖先 ${ancestorId}，请先还原祖先再还原本节点`,
      );
    }
  }
  const children = restoreSubtree(node, updatedAt);
  delete node.deleted;
  delete node.deleted_at;
  node.updated_at = updatedAt;
  writeOutlineFile(dir, tree);
  return { children };
}

/**
 * 物理删除大纲节点（DELETE /api/v1/trash/outline/:nodeId，endpoints.md 第 726-736 行）：
 * 从树中移除整棵子树（递归，文件内物理清除，不可恢复）。
 * 边界：不涉及 data.db（relations/deltas 的物理清除由上层组合）；
 * 不更新父节点 updated_at——purge 属回收站清理，节点已消失，
 * 基于它的提案快照必然失效（节点不存在），父版本戳无需联动。
 * @throws OutlineError NODE_NOT_FOUND
 */
export function purgeOutlineNode(dir: string, nodeId: string): void {
  const tree = readOutlineFile(dir);
  const parent = findParentOf(tree, nodeId);
  if (parent === undefined) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  const kids = childrenOf(parent)!;
  const idx = kids.findIndex((n) => n.id === nodeId);
  if (idx < 0) {
    throw new OutlineError("NODE_NOT_FOUND", `大纲节点不在父节点 children 中: ${nodeId}`);
  }
  kids.splice(idx, 1);
  writeOutlineFile(dir, tree);
}

/** 回收站节点条目（GET /api/v1/trash nodes 项，endpoints.md 第 668-674 行） */
export interface DeletedOutlineNodeInfo {
  id: string;
  type: Exclude<OutlineNodeType, "root">;
  title: string;
  deleted_at: string;
}

/**
 * 回收站列表（大纲侧）：收集整棵树中 deleted 标记的节点（含子树中的软删节点），
 * 按 deleted_at 倒序（回收站排序约定，schema.md：跨 SQLite 与 outline.json 统一 ISO 格式）。
 */
export function listDeletedNodes(dir: string): DeletedOutlineNodeInfo[] {
  const tree = readOutlineFile(dir);
  const out: DeletedOutlineNodeInfo[] = [];
  const visit = (node: OutlineFileNode): void => {
    if (node.deleted === true && node.deleted_at !== undefined) {
      out.push({ id: node.id, type: node.type, title: node.title, deleted_at: node.deleted_at });
    }
    for (const child of childrenOf(node) ?? []) visit(child);
  };
  for (const child of tree.children) visit(child);
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

/** 章节序条目（决策 21）：全局章序号（跨卷连续） */
export interface ChapterOrderInfo {
  chapterId: string;
  /** 全局章序号，从 1 起（root → 卷 → 章先序遍历，跨卷连续累计） */
  chapterNumber: number;
}

/**
 * 章节序推导（决策 21）：按大纲树先序遍历编号——root → 卷 → 章；
 * 全局章序号**跨卷连续**；直接挂 root 的 chapter 按兄弟顺序编号（决策 19 允许）；
 * scene 归入所属章，不单独编号（见 getChapterNumber）。
 */
export function deriveChapterOrder(dir: string): ChapterOrderInfo[] {
  const tree = readOutlineFile(dir);
  const result: ChapterOrderInfo[] = [];
  let number = 0;
  // root.children 类型已放宽为 (volume|chapter) 联合（决策 19 允许 chapter 直挂 root，
  // oracle 回修 shared 类型后此处无需断言），按 type 分支：volume → 卷内章；chapter → 直挂章
  for (const child of tree.children) {
    if (child.type === "chapter") {
      result.push({ chapterId: child.id, chapterNumber: ++number });
    } else {
      for (const ch of childrenOf(child) ?? []) {
        result.push({ chapterId: ch.id, chapterNumber: ++number });
      }
    }
  }
  return result;
}

/**
 * 节点所属章序号（决策 21）：
 * - scene → 所属 chapter 的全局序号（严格三层下 scene 的父必为 chapter）
 * - chapter → 自身序号
 * - volume / root / 节点不存在 → null（卷无章节号；不存在防御性返回 null 供上层展示）
 */
export function getChapterNumber(
  dir: string,
  nodeId: string,
): { chapterId: string; chapterNumber: number } | null {
  const tree = readOutlineFile(dir);
  let path: string[];
  try {
    path = getOutlinePathIds(tree, nodeId);
  } catch {
    return null; // 节点不存在（防御，伏笔指标/展示场景不因脏引用崩）
  }
  // 路径上最后一个 chapter（scene 的父 或 自身）
  const chapterId = [...path].reverse().find((id) => findOutlineNode(tree, id)?.type === "chapter");
  if (chapterId === undefined) return null;
  const order = deriveChapterOrder(dir).find((c) => c.chapterId === chapterId);
  return order ?? null;
}
