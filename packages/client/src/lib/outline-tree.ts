// 大纲树辅助纯函数（S2.3）：父节点按类型过滤（严格三层）+ 子节点查找（move order 计算）
import type { OutlineChapter, OutlineNode, OutlineTree } from "@whispering233/ai-editor-shared";
import { numberVisibleOutline } from "@whispering233/ai-editor-shared";
import type { OutlineNodeType } from "./api";
import { outlineTagsFromData } from "./outline-tags";

/** 大纲根（虚拟）id——**卷**挂 root 时使用的 parent_id（章只挂卷，2026-09） */
export const ROOT_NODE_ID = "root";

/** 父节点候选（树形下拉选项；depth：root=0、卷=1、章=2，用于缩进展示） */
export interface ParentOption {
  id: string;
  label: string;
  depth: number;
}

/** root 虚拟父选项（**只有 volume 挂 root**；2026-09 起章不再直接挂根） */
export const ROOT_PARENT_OPTION: ParentOption = { id: ROOT_NODE_ID, label: "（根）", depth: 0 };

/** 递归遍历用节点视图（OutlineNode 判别联合中 scene 无 children 属性——访问时收窄为可选） */
type TreeNode = OutlineNode & { children?: TreeNode[] };

/**
 * 按类型返回合法父节点候选（严格三层，与 db `assertCanHold` 同口径）：
 * - volume → 仅 root（隐藏选择器场景由调用方处理，本函数仍返回 [root]）
 * - chapter → 全部 volume（**不含 root**——2026-09 收紧：章只挂卷；存量根级章可渲染但与前端无关）
 * - scene → 全部 chapter（不含 root/volume）
 * 遍历序 = 树序（创建对话框下拉的展示序）
 */
export function parentOptionsForType(nodes: OutlineNode[], type: OutlineNodeType): ParentOption[] {
  if (type === "volume") return [ROOT_PARENT_OPTION];
  const options: ParentOption[] = [];
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

/**
 * 节点总数超过该值时，大纲页初始只展开卷（实测：4,020 节点的书全展开 = 3,020 行 /
 * 58,579 DOM / long task 共 4.3s；20 卷收起后首屏与二百节点级小书同量级）。
 * 小书（≤ 阈值）行为不变——仍然全展开。
 */
export const OUTLINE_AUTO_COLLAPSE_NODE_LIMIT = 300;

/**
 * 大纲页的初始折叠集合：小树返回空集（= 全部展开，既有行为）；大树返回**全部卷 id**
 * （章与场景收起，展开某一卷才渲染它的子树）。
 * 只决定"初始"状态——调用方必须按项目初始化一次，不能在每次树重拉后重算
 * （否则用户手动展开的卷会被 reload 反复重置）。
 */
export function initialCollapsedNodes(tree: OutlineTree | null): Set<string> {
  if (tree === null) return new Set();
  if (flattenTree(tree.children).length <= OUTLINE_AUTO_COLLAPSE_NODE_LIMIT) return new Set();
  return new Set(tree.children.filter((node) => node.type === "volume").map((node) => node.id));
}

/** targetId 是否在 nodeId 的子树中（含 nodeId 自身）——拖拽「不能挂自己/后代」判定 */export function isDescendant(nodes: OutlineNode[], nodeId: string, targetId: string): boolean {
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
 * 删除 `deletedId` 是否会让 URL 选中（`selectedId`）失效——删除的是它自身或其祖先。
 * 选中节点不在树中（坏 id）→ false：坏 id 的空态与返回引导归详情列，删除动作不收敛 URL。
 */
export function deleteInvalidatesSelection(
  nodes: OutlineNode[],
  deletedId: string,
  selectedId: string,
): boolean {
  const path = findNodePath(nodes, selectedId);
  return path !== null && path.includes(deletedId);
}

/**
 * 拖拽移动合法性（严格三层 + 不自挂/不挂子树）：
 * - 目标父必须是该节点类型的合法父（parentOptionsForType）
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
 * 在树中查找节点（或 root）的子节点列表——拖拽移动计算目标 order 用。
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

/** 拖拽插入目标（行锚点前后 / 整行落为子级 / 顶层空白区末尾）；null = 无有效目标 */
export type DragTarget =
  | { kind: "before"; nodeId: string } // 插到该节点前（该行上边缘指示线）
  | { kind: "after"; nodeId: string } // 插到该节点后（该行下边缘指示线）
  | { kind: "inside"; nodeId: string } // 整行 = 追加为该节点子级末尾（行体高亮，无插入线）
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
 * 拖拽插入锚点的目标父计算用：插到某行前/后 = 目标父 = 该行的父。*/
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
 * 拖拽 drop 前的「原地放置」判定：父不变且移动后位置不变 → 不发请求（避免无意义移动与误导 toast）。*/
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

/** 拖拽落点判定结果：目标父 + 插入位置 + 行指示形态（`inside` = 整行高亮，不画插入线） */
export interface DropPlan {
  parentId: string;
  insert: DropInsert;
  target: NonNullable<DragTarget>;
}

/**
 * 拖拽落点判定（handleDragOver / handleDrop 共用），按优先级：
 * 1. 目标行的**父**可承载拖拽节点 → 该行上 / 下半 = 同级插前 / 插后（卷 → 卷仍是同级前后）
 * 2. 否则目标行**自身**可承载（空卷 / 折叠卷 / 空章，也含展开的非空卷 / 非空章）→
 *    整行 = 追加为该行子级末尾（`inside`）
 * 3. 都不合法 → null（不显示落点指示、不发 move）
 *
 * 为什么不能只按「目标行自身可承载」判定同级插入：scene 可挂 chapter，但插到章行前 / 后 = 插进
 * 卷 = 400 INVALID_HIERARCHY。回退只解「目标父不合法」这一种情况。
 */
export function resolveDropPlan(
  nodes: OutlineNode[],
  dragNodeId: string,
  targetNodeId: string,
  side: "before" | "after",
): DropPlan | null {
  const dragNode = findNode(nodes, dragNodeId);
  if (dragNode === null) return null;
  const parentId = findParentIdOf(nodes, targetNodeId);
  if (parentId !== null && canMoveTo(dragNode, parentId, nodes)) {
    return {
      parentId,
      insert: { kind: side, nodeId: targetNodeId },
      target: { kind: side, nodeId: targetNodeId },
    };
  }
  const targetNode = findNode(nodes, targetNodeId);
  if (targetNode !== null && canMoveTo(dragNode, targetNode.id, nodes)) {
    return {
      parentId: targetNode.id,
      insert: { kind: "end" },
      target: { kind: "inside", nodeId: targetNode.id },
    };
  }
  return null;
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

// ============ 章节点选项（锚点仅章：Delta / current_position / 伏笔锚点都只挂在章上） ============

/**
 * 章节点选项（扁平化 + 缩进 `depth`，保留原层级深度）：所有"选章"的下拉共用（伏笔埋点/推进回收、
 * 人物页「阅读进度」的进度节点、通用 compute 探针）——卷/场景不承载锚点，服务端写入侧同样 400。
 * 软删节点及其子树跳过。
 */
export function chapterNodeOptions(tree: OutlineTree | null): FlatNodeOption[] {
  const out: FlatNodeOption[] = [];
  const visit = (nodes: readonly OutlineNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.deleted === true) continue;
      if (node.type === "chapter") out.push({ id: node.id, label: node.title, depth });
      if (node.type !== "scene" && node.children) visit(node.children, depth + 1);
    }
  };
  visit(tree?.children ?? [], 0);
  return out;
}

/** 章节点是否存在且未软删（`current_position` 的章级有效性判定——锚点仅章） */
export function chapterNodeExists(tree: OutlineTree | null, nodeId: string): boolean {
  return chapterNodeOptions(tree).some((o) => o.id === nodeId);
}

// ============ 大纲编号（展示口径：只计可见节点，删章后重排） ============
// 与服务端 `deriveChapterOrder`（含软删章、保 Delta/伏笔引用稳定）**不同源**——见
// `docs/design/10-data-model.md` §4「UI 展示编号 ≠ 本节的章序」：本处编号只作展示，不参与任何计算。

/** 阅读序章行（卷序 → 卷内章序；供 `chapterNeighbors` 取上一/下一章） */
export interface OutlineChapterRow {
  chapter: OutlineChapter;
  /** 所属卷 id；**存量直挂 root 的章** = `ROOT_NODE_ID` */
  volumeId: string;
  /** 所属卷的编号徽标文案（`第N卷`）；根级章无卷 → 空串 */
  volumeLabel: string;
  /** 章编号徽标文案（`第N章`） */
  chapterLabel: string;
}

/** 大纲编号结果（树视图按 `labels` 查；`chapterRows` 供阅读序取相邻章） */
export interface OutlineNumbering {
  /** 节点 id → 编号徽标文案（`第1卷` / `第3章`）；**场景不编号**，不入 Map */
  labels: Map<string, string>;
  /** 阅读序章行（先序 = 阅读序） */
  chapterRows: OutlineChapterRow[];
}

/**
 * 从整树推导大纲编号（展示口径）：
 * - 卷序 = 顶层卷按**文件位置序** 1-based（只计可见卷）
 * - 章序 = 全书先序连续（跨卷累计，含存量直挂 root 的章——它们不占卷号）
 * - **只计可见节点**（`deleted === true` 的节点及其子树跳过）⇒ 删章后编号重排
 * - `null` / 空树 → 空结果
 *
 * 编号派生（含章序）全部来自 shared `numberVisibleOutline`（**唯一编号口径**）；本函数只做
 * 「节点 id → 徽标文案」与「章行 → 树节点」两处形态转换（含 root 直挂章 → `ROOT_NODE_ID`）。
 */
export function numberOutline(tree: OutlineTree | null): OutlineNumbering {
  const { volumes, chapters } = numberVisibleOutline(tree);
  const labels = new Map<string, string>();
  for (const volume of volumes) labels.set(volume.volumeId, volume.volumeLabel);
  const chapterRows: OutlineChapterRow[] = [];
  for (const chapter of chapters) {
    const node = findNode(tree?.children ?? [], chapter.chapterId);
    if (node === null || node.type !== "chapter") continue; // 类型上不可达（章序来自同一棵树）；防御：不留半行
    labels.set(node.id, chapter.chapterLabel);
    chapterRows.push({
      chapter: node,
      volumeId: chapter.volumeId === "" ? ROOT_NODE_ID : chapter.volumeId,
      volumeLabel: chapter.volumeLabel,
      chapterLabel: chapter.chapterLabel,
    });
  }
  return { labels, chapterRows };
}

// ============ 树筛选（隐藏不重排：状态 / 剧情线标签，组件态不持久化） ============
// 口径与画布筛选（`lib/outline-canvas-filter.ts`）一致：**同维度 OR、跨维度 AND、空数组 = 不限制**；
// 筛选只决定渲染哪些行——不改结构、不重排、**不改编号**（编号恒按全树 `numberOutline` 派生）。

/** 大纲树筛选条件（组件态：刷新即清，不写 localStorage、不进 URL） */
export interface OutlineFilter {
  /** 章写作状态（`OUTLINE_STATUS`；空 = 不限制）——**只有章有状态字段**，卷 / 场景不因状态命中 */
  statuses: string[];
  /** 剧情线标签（`data.tags`；空 = 不限制）——章与场景都有 */
  tags: string[];
}

/** 无条件（= 不过滤；页面初始态） */
export const EMPTY_OUTLINE_FILTER: OutlineFilter = { statuses: [], tags: [] };

/** 是否有任何筛选条件（决定拖拽禁用 / 空结果提示 / 按钮高亮） */
export function isOutlineFilterActive(filter: OutlineFilter): boolean {
  return filter.statuses.length > 0 || filter.tags.length > 0;
}

/** 数组内切换一个值（不改原数组：筛选条件按引用比较） */
export function toggleFilterValue(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

/**
 * 单节点是否命中：跨维度 AND。**没带该维度字段的节点不命中**（卷无状态无标签、场景无状态）——
 * 否则按状态筛选会把整棵树原样留下（卷 / 场景不带状态 ⇒ 无条件通过）。
 */
function matchesOutlineFilter(node: OutlineNode, filter: OutlineFilter): boolean {
  if (filter.statuses.length > 0) {
    if (node.type !== "chapter") return false;
    const raw = node.data?.status;
    const status = typeof raw === "string" ? raw : "draft"; // 缺省 / 非法值 = 草稿（同画布卡片口径）
    if (!filter.statuses.includes(status)) return false;
  }
  if (filter.tags.length > 0) {
    if (node.type === "volume") return false;
    const tags = outlineTagsFromData(node.data);
    if (!tags.some((tag) => filter.tags.includes(tag))) return false;
  }
  return true;
}

/**
 * 按筛选条件过滤树：命中节点**连同其祖先链**保留（否则子节点无处挂），未命中的整枝丢弃；
 * 全部不命中 → 空数组。软删节点及其子树跳过（与编号 `numberVisibleOutline` 同口径；
 * 服务端 tree 已滤，此处防御）。无筛选条件 → 原样返回（不复制整树）。
 */
export function filterOutlineNodes(
  nodes: readonly OutlineNode[],
  filter: OutlineFilter,
): OutlineNode[] {
  if (!isOutlineFilterActive(filter)) return nodes as OutlineNode[];
  const kept: OutlineNode[] = [];
  for (const node of nodes) {
    if (node.deleted === true) continue;
    const children = node.type === "scene" ? [] : filterOutlineNodes(node.children ?? [], filter);
    if (children.length === 0 && !matchesOutlineFilter(node, filter)) continue;
    kept.push(node.type === "scene" ? node : ({ ...node, children } as OutlineNode));
  }
  return kept;
}
