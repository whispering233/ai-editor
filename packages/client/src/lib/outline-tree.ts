// 大纲树辅助纯函数（S2.3）：父节点按类型过滤（决策 19 严格三层）+ 子节点查找（move order 计算）
// 契约来源：doc/ui/pages/outline.md「父节点按类型过滤：volume → 固定 root；chapter → root 或 volume；
//   scene → 仅 chapter」+ endpoints.md「POST /outline parent_id 必填（volume→root、chapter→volume/root、scene→chapter）」
import type { OutlineNode } from "@whispering233/ai-editor-shared";
import type { OutlineNodeType } from "./api";

/** 大纲根（虚拟）id——volume/chapter 挂 root 时使用的 parent_id（决策 19） */
export const ROOT_NODE_ID = "root";

/** 父节点候选（树形下拉选项；depth：root=0、卷=1、章=2，用于缩进展示） */
export interface ParentOption {
  id: string;
  label: string;
  depth: number;
}

/** root 虚拟父选项（volume 固定、chapter 可选） */
export const ROOT_PARENT_OPTION: ParentOption = { id: ROOT_NODE_ID, label: "（根）", depth: 0 };

/** 递归遍历用节点视图（OutlineNode 判别联合中 scene 无 children 属性——访问时收窄为可选） */
type TreeNode = OutlineNode & { children?: TreeNode[] };

/**
 * 按类型返回合法父节点候选（严格三层，决策 19）：
 * - volume → 仅 root（隐藏选择器场景由调用方处理，本函数仍返回 [root]）
 * - chapter → root + 全部 volume
 * - scene → 全部 chapter（不含 root/volume）
 * 遍历序 = 树序（创建对话框下拉的展示序）
 */
export function parentOptionsForType(nodes: OutlineNode[], type: OutlineNodeType): ParentOption[] {
  if (type === "volume") return [ROOT_PARENT_OPTION];
  const options: ParentOption[] = type === "chapter" ? [ROOT_PARENT_OPTION] : [];
  const collect = (children: TreeNode[], depth: number): void => {
    for (const node of children) {
      if (type === "chapter" && node.type === "volume") {
        options.push({ id: node.id, label: node.title, depth });
      } else if (type === "scene" && node.type === "chapter") {
        options.push({ id: node.id, label: node.title, depth });
      }
      if (node.children) collect(node.children, depth + 1);
    }
  };
  collect(nodes as TreeNode[], 1);
  return options;
}

/**
 * 在树中查找节点（按 id；含 root 虚拟 id 时返回 null——root 不是 OutlineNode）
 */
export function findNode(nodes: OutlineNode[], nodeId: string): OutlineNode | null {
  for (const n of nodes) {
    if (n.id === nodeId) return n;
    if (n.type !== "scene" && n.children) {
      const found = findNode(n.children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 根到节点的祖先链（含节点自身，不含虚拟 root），如 ["vol-1","ch-3","sc-9"]；
 * 找不到返回 null。跨页定位用（U4）：展开折叠祖先使节点进入 DOM + 确认节点存在。
 */
export function findNodePath(
  nodes: OutlineNode[],
  nodeId: string,
  path: string[] = [],
): string[] | null {
  for (const n of nodes) {
    const next = [...path, n.id];
    if (n.id === nodeId) return next;
    if (n.type !== "scene" && n.children) {
      const found = findNodePath(n.children, nodeId, next);
      if (found) return found;
    }
  }
  return null;
}

/** 树扁平化选项（S3.6 大纲节点选择器用）：树序遍历 { id, title, depth }（root=0、卷=1、章=2） */
export interface FlatNodeOption {
  id: string;
  label: string;
  depth: number;
}

export function flattenTree(
  nodes: OutlineNode[],
  depth = 0,
  acc: FlatNodeOption[] = [],
): FlatNodeOption[] {
  for (const n of nodes) {
    acc.push({ id: n.id, label: n.title, depth });
    if (n.type !== "scene" && n.children) flattenTree(n.children, depth + 1, acc);
  }
  return acc;
}

/** targetId 是否在 nodeId 的子树中（含 nodeId 自身）——拖拽「不能挂自己/后代」判定 */
export function isDescendant(nodes: OutlineNode[], nodeId: string, targetId: string): boolean {
  const node = findNode(nodes, nodeId);
  if (!node) return false;
  const search = (n: OutlineNode): boolean => {
    if (n.id === targetId) return true;
    if (n.type !== "scene" && n.children) {
      return n.children.some((c) => search(c));
    }
    return false;
  };
  return search(node);
}

/**
 * 拖拽移动合法性（严格三层 + 不自挂/不挂子树）：
 * - 目标父必须是该节点类型的合法父（parentOptionsForType，决策 19）
 * - 不能挂到自己（targetId === nodeId）或自己的后代（子树）
 */
export function canMoveTo(
  node: OutlineNode,
  targetParentId: string,
  nodes: OutlineNode[],
): boolean {
  if (targetParentId === node.id) return false;
  if (isDescendant(nodes, node.id, targetParentId)) return false;
  return parentOptionsForType(nodes, node.type).some((o) => o.id === targetParentId);
}

/** 行内标题编辑提交判定：非空且有变化才提交（空标题不合法；无变化不发请求） */
export function shouldCommitTitle(original: string, value: string): boolean {
  const v = value.trim();
  return v !== "" && v !== original.trim();
}

/** 行内摘要编辑提交判定：有变化才提交（允许清空 = 清除摘要；无变化不发请求） */
export function shouldCommitSummary(original: string | undefined, value: string): boolean {
  return value.trim() !== (original ?? "").trim();
}

/**
 * 行内编辑提交失败后的恢复决策（S2.4 oracle 补丁）：
 * - OUTLINE_NODE_NOT_FOUND → "abandon"：节点已不存在（被 purge/并发删除），编辑无意义，放弃并重拉树
 * - 其余错误 → "restore"：恢复编辑态并保留用户输入，可修正后重试
 */
export function editFailureRecovery(code: string | null): "abandon" | "restore" {
  return code === "OUTLINE_NODE_NOT_FOUND" ? "abandon" : "restore";
}

/**
 * 在树中查找节点（或 root）的子节点列表——move 对话框计算目标 order 用。
 * root → 树的顶层 children；目标不存在 → null；目标无 children（scene）→ []
 */
export function findNodeChildren(nodes: OutlineNode[], nodeId: string): OutlineNode[] | null {
  if (nodeId === ROOT_NODE_ID) return nodes;
  const search = (children: TreeNode[]): OutlineNode[] | null => {
    for (const node of children) {
      if (node.id === nodeId) return node.children ?? [];
      if (node.children) {
        const found = search(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return search(nodes as TreeNode[]);
}

// ============ 拖拽插入位置（S13.1：上下半判定 + 插入指示线，同级排序可用） ============

/** 拖拽插入目标（行锚点前后 / 顶层空白区末尾）；null = 无有效目标 */
export type DragTarget =
  | { kind: "before"; nodeId: string } // 插到该节点前（该行上边缘指示线）
  | { kind: "after"; nodeId: string } // 插到该节点后（该行下边缘指示线）
  | { kind: "root-end" } // 顶层空白区：排 root 末尾
  | null;

/** 拖拽插入位置（order 计算输入；end = 目标父 children 末尾） */
export type DropInsert =
  { kind: "before"; nodeId: string } | { kind: "after"; nodeId: string } | { kind: "end" };

/**
 * 插入位置 → order（0-based）：before = 目标 index；after = index + 1；end = siblings.length（末尾）。
 * **剔除拖拽节点后计算**（oracle M1 修复，方案 B）：服务端 move 语义 = 先从原父 children 移除节点、
 * 再插入 order（clamp）——order 必须在**剔除拖拽节点后的数组**上计算；否则同父重排锚点在拖拽节点
 * 下方时会错位 1 位（兄弟 [A,B,C,D] 拖 B 到 C 后，pre-removal 数组算得 order 3 → 实际插入 3 得
 * [A,C,D,B] 而非期望 [A,C,B,D]）。交叉父移动时目标父不含拖拽节点，剔除无效果。
 * 目标不在 siblings 中（异常/已移动）→ 回退末尾（不 +1——防越界）。
 */
export function dropInsertOrder(
  children: OutlineNode[],
  insert: DropInsert,
  /** 拖拽节点 id（同父重排时剔除；交叉父/顶层 end 时数组不含它，剔除无效果） */
  excludeId?: string,
): number {
  const siblings = excludeId === undefined ? children : children.filter((n) => n.id !== excludeId);
  if (insert.kind === "end") return siblings.length;
  const idx = siblings.findIndex((n) => n.id === insert.nodeId);
  if (idx === -1) return siblings.length;
  return insert.kind === "before" ? idx : idx + 1;
}

/** 两个拖拽目标是否等价（dragover 高频触发用：等价则不更新 state，避免无谓重渲染） */
export function sameDragTarget(a: DragTarget, b: DragTarget): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "root-end" || b.kind === "root-end") return a.kind === b.kind;
  return a.kind === b.kind && a.nodeId === b.nodeId;
}

/** 节点在树中的直接父 id（root 下的节点 → ROOT_NODE_ID）；找不到 → null。
 * 拖拽插入锚点的目标父计算用：插到某行前/后 = 目标父 = 该行的父。 */
export function findParentIdOf(nodes: OutlineNode[], nodeId: string): string | null {
  const search = (children: TreeNode[], parentId: string): string | null => {
    for (const node of children) {
      if (node.id === nodeId) return parentId;
      if (node.children) {
        const found = search(node.children, node.id);
        if (found !== null) return found;
      }
    }
    return null;
  };
  return search(nodes as TreeNode[], ROOT_NODE_ID);
}

/** 节点当前位置（父 id + 兄弟序号 index）；找不到 → null。
 * 拖拽 drop 前的「原地放置」判定：父不变且移动后位置不变 → 不发请求（避免无意义移动与误导 toast）。 */
export function findNodePosition(
  nodes: OutlineNode[],
  nodeId: string,
): { parentId: string; index: number } | null {
  const parentId = findParentIdOf(nodes, nodeId);
  if (parentId === null) return null;
  const children = findNodeChildren(nodes, parentId) ?? [];
  const index = children.findIndex((n) => n.id === nodeId);
  return index === -1 ? null : { parentId, index };
}

/**
 * 拖放是否为**原地放置**（父不变且移动后位置不变 → 无需请求）。
 * order 为**剔除拖拽节点后**的插入位置（dropInsertOrder 第三参语义）——服务端移除节点后插入该 order
 * 的位置恰与当前 index 相同即原地；order 与当前 index 的偏差即真实位移，无需再模拟服务端 clamp。
 * 跨父移动 → false（必然移动）。
 */
export function isNoopDrop(
  nodes: OutlineNode[],
  dragNodeId: string,
  targetParentId: string,
  order: number,
): boolean {
  const pos = findNodePosition(nodes, dragNodeId);
  if (pos === null || pos.parentId !== targetParentId) return false;
  return order === pos.index;
}
