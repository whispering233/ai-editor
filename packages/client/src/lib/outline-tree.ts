// 大纲树辅助纯函数（S2.3）：父节点按类型过滤（决策 19 严格三层）+ 子节点查找（move order 计算）
// 契约来源：doc/ui/pages/outline.md「父节点按类型过滤：volume → 固定 root；chapter → root 或 volume；
//   scene → 仅 chapter」+ endpoints.md「POST /outline parent_id 必填（volume→root、chapter→volume/root、scene→chapter）」
import type { OutlineNode } from "@ai-editor/shared";
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
export function canMoveTo(node: OutlineNode, targetParentId: string, nodes: OutlineNode[]): boolean {
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
