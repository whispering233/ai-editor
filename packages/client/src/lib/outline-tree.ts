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
 * 创建对话框父节点选择规则（S2.3 oracle 修复）：当前选中值（含入口 initialParentId）合法则保留，
 * 否则回退到第一个合法选项（或空）。
 * - volume → 固定 root（忽略 current）
 * - 其余 → current 在 parentOptionsForType 选项中 → 保留；不在（类型切换后旧父失效/入口给了非法父）→ 回退 options[0]
 * 这样「卷行→新建章」「章行→新建场景」入口指定的父节点不会被挂载重置覆盖
 */
export function resolveParentId(
  current: string | undefined,
  type: OutlineNodeType,
  nodes: OutlineNode[],
): string {
  if (type === "volume") return ROOT_NODE_ID;
  const options = parentOptionsForType(nodes, type);
  const validIds = new Set(options.map((o) => o.id));
  if (current !== undefined && validIds.has(current)) return current;
  return options.length > 0 ? options[0].id : "";
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
