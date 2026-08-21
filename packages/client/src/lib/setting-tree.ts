// 设定树构建纯函数（批次四 I4，决策 30 + 决策 42 交互树扩展）：由全量 setting 摘要 + 全量
// belongs_to 层级边组装递归树。契约：doc/ui/pages/entity-list.md「设定 Tab（树形视图）」。
// - 层级边方向：childId → parentId（child belongs_to parent）
// - 根节点 = 不在任何边 target 端的设定（无父）；软删端点已由服务端可见性过滤，
//   悬空引用（父已不存在）的边在 edges 中不出现
// - 溢出防御：父实体的 id 未出现在 settings 中（命中 limit 截断）时，该子节点提升为根，
//   避免子树整体丢失
// - 决策 42（2026-08 批次十）：交互树需要完整摘要（标签过滤/描述展示）与直接父 id（拖拽
//   no-op 判定）与 belongs_to 关系 id（拖拽改父删旧边）——SettingTreeInput/Node 增补可选字段，
//   SettingTreeEdge 增补可选 relationId；旧只读树调用（不传这些字段）行为不变
export interface SettingTreeEdge {
  childId: string;
  parentId: string;
  /** belongs_to 关系 id（决策 42 交互树：拖拽改父时删旧边用；旧只读树可省略） */
  relationId?: string;
}

export interface SettingTreeInput {
  id: string;
  name: string;
  /** 列表摘要 category（EntitySummary.summary.category，字符串或缺失；决策 31 已废弃，防御容错） */
  category?: unknown;
  /** 完整列表摘要（决策 42 交互树：标签过滤/描述展示用；EntitySummary.summary） */
  summary?: Record<string, unknown>;
  /** 直接父设定 id（决策 42 交互树：拖拽 no-op 判定；根节点无此字段） */
  parentId?: string;
  /** 创建时间（决策 46 排序模式「创建时间」用；EntitySummary.createdAt） */
  createdAt?: string;
  /** 同级手动排序位（决策 46：EntitySummary.sortOrder，NULL = 未参与 → 不出现） */
  sortOrder?: number;
}

export interface SettingTreeNode {
  id: string;
  name: string;
  category?: string;
  /** 完整列表摘要（决策 42 交互树：标签过滤/描述展示用） */
  summary?: Record<string, unknown>;
  /** 直接父设定 id（决策 42 交互树：拖拽 no-op 判定；根节点无此字段） */
  parentId?: string;
  /** 创建时间（决策 46 排序模式「创建时间」用） */
  createdAt?: string;
  /** 同级手动排序位（决策 46：NULL = 未参与 → 不出现，手动模式沉底按名称） */
  sortOrder?: number;
  children: SettingTreeNode[];
}

export interface BuiltSettingTree {
  /** 树根（无父的设定 + 父截断提升的节点） */
  roots: SettingTreeNode[];
  /** 是否有孤儿边（父不在已加载 settings 中——命中 limit 截断时的防御场景） */
  hasOrphanEdges: boolean;
}

export function buildSettingTree(
  settings: SettingTreeInput[],
  edges: SettingTreeEdge[],
): BuiltSettingTree {
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
      ...(typeof raw.category === "string" && raw.category !== ""
        ? { category: raw.category }
        : {}),
      ...(raw.summary !== undefined ? { summary: raw.summary } : {}),
      ...(raw.parentId !== undefined ? { parentId: raw.parentId } : {}),
      ...(raw.createdAt !== undefined ? { createdAt: raw.createdAt } : {}),
      ...(raw.sortOrder !== undefined ? { sortOrder: raw.sortOrder } : {}),
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

/**
 * 收集所有非叶子（有子节点）设定节点 id ——「全部折叠」用（批次八 O5，2026-08）。
 * 叶子无折叠箭头不参与；返回序为树先根序（折叠态集合无序，序无关紧要，保持确定性便于测试）。
 */
export function expandableSettingNodeIds(roots: readonly SettingTreeNode[]): string[] {
  const out: string[] = [];
  function walk(node: SettingTreeNode): void {
    if (node.children.length > 0) {
      out.push(node.id);
      for (const c of node.children) walk(c);
    }
  }
  for (const r of roots) walk(r);
  return out;
}

// ============ 决策 42 交互树辅助（拖拽层级调整 / 树内过滤，2026-08 批次十） ============

/** 在树中查找节点（按 id，先根序）；找不到 → null */
export function findSettingNode(
  roots: readonly SettingTreeNode[],
  id: string,
): SettingTreeNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    const found = findSettingNode(r.children, id);
    if (found) return found;
  }
  return null;
}

/** targetId 是否在 ancestorId 的子树中（含 ancestorId 自身）——拖拽「不能挂自己/后代」判定 */
export function isSettingDescendant(
  roots: readonly SettingTreeNode[],
  ancestorId: string,
  targetId: string,
): boolean {
  const ancestor = findSettingNode(roots, ancestorId);
  if (ancestor === null) return false;
  const search = (node: SettingTreeNode): boolean => {
    if (node.id === targetId) return true;
    return node.children.some((c) => search(c));
  };
  return search(ancestor);
}

/**
 * 拖拽层级合法性（决策 42，belongs_to 语义，参考大纲 canMoveTo 纯函数思路）：
 * - targetParentId null = 移到根（无上级），恒合法
 * - 不能挂到自己（targetParentId === dragNode.id）
 * - 不能挂到自己的后代（防环，决策 30：新父沿祖先链向上不得经过该子设定）
 * - 其余任意设定可互为父子（belongs_to 无层级深度限制）
 */
export function canMoveSettingTo(
  dragNode: SettingTreeNode,
  targetParentId: string | null,
  roots: readonly SettingTreeNode[],
): boolean {
  if (targetParentId === null) return true;
  if (targetParentId === dragNode.id) return false;
  return !isSettingDescendant(roots, dragNode.id, targetParentId);
}

/** 节点标签（summary.tags 数组，防御非数组/缺失；决策 31 统一字段） */
export function nodeTags(node: SettingTreeNode): string[] {
  const tags = node.summary?.tags;
  return Array.isArray(tags)
    ? (tags as unknown[]).filter((t): t is string => typeof t === "string" && t !== "")
    : [];
}

/** 节点是否命中搜索（名称包含，大小写不敏感；空 q = 全部） */
export function matchesSettingSearch(node: SettingTreeNode, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (query === "") return true;
  return node.name.toLowerCase().includes(query);
}

/** 节点是否命中标签（tags 包含；空 tag = 全部） */
export function matchesSettingTag(node: SettingTreeNode, tag: string): boolean {
  if (tag === "") return true;
  return nodeTags(node).includes(tag);
}

/**
 * 树内过滤（决策 42）：命中节点及其祖先链保留展示，非命中子树隐藏。
 * 返回过滤后的新树（不改原树）；节点「命中」= 名称含 q（空 = 全部）且 tags 含 tag（空 = 全部）。
 * 命中节点的祖先即使自身不命中也被保留（作为上下文链）；命中节点的非命中子节点被裁剪。
 */
export function filterSettingTree(
  roots: readonly SettingTreeNode[],
  q: string,
  tag: string,
): SettingTreeNode[] {
  const filterNode = (node: SettingTreeNode): SettingTreeNode | null => {
    const children = node.children.map(filterNode).filter((c): c is SettingTreeNode => c !== null);
    const selfHit = matchesSettingSearch(node, q) && matchesSettingTag(node, tag);
    if (selfHit || children.length > 0) {
      return { ...node, children };
    }
    return null;
  };
  return roots.map(filterNode).filter((n): n is SettingTreeNode => n !== null);
}

// ============ 决策 46（2026-08 批次十三）：同级排序模式 ============

/** 设定树排序方式（决策 46）：name = 名称（原默认）；created = 创建时间（新→旧）；
 * manual = 手动排序（sortOrder 升序，NULL 沉底按名称——未参与手动排序的渐进生效）。
 * 排序粒度 = 同级兄弟（每个父/根级的子列表），层级结构不变。 */
export type SettingSortMode = "name" | "created" | "manual";

/** 排序键辅助：字符串比较（与 SQLite 默认字节序一致，名称排序可预期） */
function compareName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 同级组排序（决策 46）：返回**新数组**（不改原数组——原树保持组装序）：
 * - name：名称升序（id 决胜稳定）
 * - created：创建时间降序（新→旧；缺失时间戳沉底，id 决胜）
 * - manual：sortOrder 升序（NULL/缺失 = 未参与 → 沉底按名称），同序值按名称
 */
export function sortSettingChildren(
  nodes: readonly SettingTreeNode[],
  mode: SettingSortMode,
): SettingTreeNode[] {
  const list = [...nodes];
  list.sort((a, b) => {
    if (mode === "created") {
      if (a.createdAt !== undefined && b.createdAt !== undefined && a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? 1 : -1; // 新→旧
      }
      if (a.createdAt === undefined && b.createdAt !== undefined) return 1; // 缺失沉底
      if (a.createdAt !== undefined && b.createdAt === undefined) return -1;
    } else if (mode === "manual") {
      const ao = a.sortOrder ?? Number.POSITIVE_INFINITY;
      const bo = b.sortOrder ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
    }
    const nameCmp = compareName(a.name, b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.id < b.id ? -1 : 1;
  });
  return list;
}
