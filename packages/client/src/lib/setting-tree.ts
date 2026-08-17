// 设定树构建纯函数（批次四 I4，决策 30）：由全量 setting 摘要 + 全量 belongs_to 层级边
// 组装递归树。契约：doc/ui/pages/entity-list.md「设定树 Tab」。
// - 层级边方向：childId → parentId（child belongs_to parent）
// - 根节点 = 不在任何边 target 端的设定（无父）；软删端点已由服务端可见性过滤，
//   悬空引用（父已不存在）的边在 edges 中不出现
// - 溢出防御：父实体的 id 未出现在 settings 中（命中 limit 截断）时，该子节点提升为根，
//   避免子树整体丢失
export interface SettingTreeEdge {
  childId: string;
  parentId: string;
}

export interface SettingTreeInput {
  id: string;
  name: string;
  /** 列表摘要 category（EntitySummary.summary.category，字符串或缺失） */
  category?: unknown;
}

export interface SettingTreeNode {
  id: string;
  name: string;
  category?: string;
  children: SettingTreeNode[];
}

export interface BuiltSettingTree {
  /** 树根（无父的设定 + 父截断提升的节点） */
  roots: SettingTreeNode[];
  /** 是否有孤儿边（父不在已加载 settings 中——命中 limit 截断时的防御场景） */
  hasOrphanEdges: boolean;
}

export function buildSettingTree(settings: SettingTreeInput[], edges: SettingTreeEdge[]): BuiltSettingTree {
  const byId = new Map<string, SettingTreeInput>();
  for (const s of settings) byId.set(s.id, s);

  // parentOf：childId → parentId（根判定用）；childOf：parentId → 子 id 数组（组装用，保持输入序）
  const parentOf = new Map<string, string>();
  const childOf = new Map<string, string[]>();
  for (const e of edges) {
    parentOf.set(e.childId, e.parentId);
    const list = childOf.get(e.parentId) ?? [];
    list.push(e.childId);
    childOf.set(e.parentId, list);
  }

  // 递归组装（服务端已防环，无需环守卫；叶子 children 为空数组）
  function assemble(id: string): SettingTreeNode | null {
    const raw = byId.get(id);
    if (raw === undefined) return null; // 防御：父在截断外 → 由调用方提升为根
    const node: SettingTreeNode = {
      id: raw.id,
      name: raw.name,
      ...(typeof raw.category === "string" && raw.category !== "" ? { category: raw.category } : {}),
      children: [],
    };
    const kids = childOf.get(id) ?? [];
    for (const kid of kids) {
      const child = assemble(kid);
      if (child !== null) node.children.push(child);
    }
    return node;
  }

  const roots: SettingTreeNode[] = [];
  let hasOrphanEdges = false;
  for (const s of settings) {
    const parentId = parentOf.get(s.id);
    if (parentId === undefined) {
      roots.push(assemble(s.id)!); // 无父 → 根（assemble 必非 null：byId 命中自身）
    } else if (!byId.has(parentId)) {
      // 防御：父实体未加载（>limit 截断）→ 提升为根，不丢子树
      hasOrphanEdges = true;
      roots.push(assemble(s.id)!);
    }
  }
  return { roots, hasOrphanEdges };
}