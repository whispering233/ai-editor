// 能力面板树变换纯函数（卡片 3.4）
//
// 契约：`docs/db/schema.md`「`ability_panel` 能力面板结构」/「面板路径解析口径」、
// `docs/design/10-data-model.md` §14 不变式 4/5/6（结构人工编辑不产生 Delta、叶子值 string|number、
// 模板派生 = 结构快照深拷贝）。
//
// - **每次变换先过 `parseAbilityPanel`、变换后再过一遍** → 返回值恒为**规范形状**
//   （分支丢弃 `value`、空 `children` 归一为叶子、未知键/坏元素在编辑入口即被清理）
// - **节点寻址 = 索引路径**（`number[]`，空数组 = 根）：点分**名**路径在同层重名 / 名字含 `.`
//   时有歧义（那是 Delta 字段路径的解析口径），编辑器内部不得复用，否则「改名后拖错行」
// - 非法操作返回 `null`（空名、路径不存在、拖进自身子树）——**不静默改写数据**
import type { AbilityPanelNode } from "@whispering233/ai-editor-shared";
import { coerceAbilityValue, parseAbilityPanel } from "@whispering233/ai-editor-shared";

/** 索引路径（从根数组起的下标链；空数组 = 根层级） */
export type PanelIndexPath = readonly number[];

/** 索引路径 → 稳定字符串键（React key / Map 键 / 拖拽载荷——下标链不含歧义字符） */
export function panelPathKey(path: PanelIndexPath): string {
  return path.join(".");
}

/** 取节点（路径不存在 → null） */
export function panelNodeAt(
  nodes: readonly AbilityPanelNode[],
  path: PanelIndexPath,
): AbilityPanelNode | null {
  let current: readonly AbilityPanelNode[] = nodes;
  let node: AbilityPanelNode | null = null;
  for (const index of path) {
    const next = current[index];
    if (next === undefined) return null;
    node = next;
    current = next.children ?? [];
  }
  return node;
}

/** 父节点的子数组（`parentPath = []` → 根数组）；路径不存在 → null。
 * **叶子父节点按不变式转分支**（丢弃 `value`——分支不可赋值）；空数组由 `parseAbilityPanel` 归一回叶子 */
function childrenAt(
  nodes: AbilityPanelNode[],
  parentPath: PanelIndexPath,
): AbilityPanelNode[] | null {
  if (parentPath.length === 0) return nodes;
  const parent = panelNodeAt(nodes, parentPath);
  if (parent === null) return null;
  if (!Array.isArray(parent.children)) {
    delete parent.value;
    parent.children = [];
  }
  return parent.children;
}

/** 在 `parentPath` 的 `index` 位插入新节点（`index` 越界 → 收敛到末尾）；空名/父路径不存在 → null */
export function insertPanelNode(
  nodes: readonly AbilityPanelNode[],
  parentPath: PanelIndexPath,
  index: number,
  name: string,
): AbilityPanelNode[] | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  const tree = parseAbilityPanel(nodes);
  const siblings = childrenAt(tree, parentPath);
  if (siblings === null) return null;
  const at = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, { name: trimmed });
  return parseAbilityPanel(tree);
}

/** 改名（空名/纯空白 → null；路径不存在 → null） */
export function renamePanelNode(
  nodes: readonly AbilityPanelNode[],
  path: PanelIndexPath,
  name: string,
): AbilityPanelNode[] | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  const tree = parseAbilityPanel(nodes);
  const node = panelNodeAt(tree, path);
  if (node === null) return null;
  node.name = trimmed;
  return parseAbilityPanel(tree);
}

/**
 * 删除节点（子树一并删）。父节点因此失去全部子节点 → **降级为叶子**（`parseAbilityPanel` 归一：
 * `children` 空数组被删、节点恢复可赋值）。
 */
export function removePanelNode(
  nodes: readonly AbilityPanelNode[],
  path: PanelIndexPath,
): AbilityPanelNode[] | null {
  if (path.length === 0) return null; // 根数组不可删
  const tree = parseAbilityPanel(nodes);
  const parentPath = path.slice(0, -1);
  const siblings = childrenAt(tree, parentPath);
  if (siblings === null) return null;
  const index = path[path.length - 1]!;
  if (siblings[index] === undefined) return null;
  siblings.splice(index, 1);
  return parseAbilityPanel(tree);
}

/**
 * 叶子赋值（`raw` 为空/纯空白 → 清空该值）。**分支不可赋值** / 路径不存在 → null；
 * 值未变化 → **原样返回入参**（调用方可据此跳过状态更新，不做无谓重渲染）。
 */
export function setPanelLeafValue(
  nodes: readonly AbilityPanelNode[],
  path: PanelIndexPath,
  raw: string,
): AbilityPanelNode[] | null {
  const tree = parseAbilityPanel(nodes);
  const node = panelNodeAt(tree, path);
  if (node === null) return null;
  if (Array.isArray(node.children) && node.children.length > 0) return null; // 分支不可赋值

  const next = coerceAbilityValue(raw);
  if (node.value === next) return nodes as AbilityPanelNode[];
  if (next === undefined) delete node.value;
  else node.value = next;
  return parseAbilityPanel(tree);
}

/**
 * 移动/重排：`from` 节点移到 `to.parent` 的 `to.index` 位（`index` 越界收敛到末尾）。
 *
 * 语义（与大纲/设定树的拖拽语言一致）：
 * - `to.parent` 与被移动节点**同一父** → 同级重排（先摘后插，index 按**摘除后**的数组算）
 * - `to.parent` 为其它分支 → 成为其子级（父节点因此变分支，其叶子 `value` 按不变式丢弃）
 * - **拖进自身/自身子树 → null**（防环）；`from === to.parent` 亦属此类
 */
export function movePanelNode(
  nodes: readonly AbilityPanelNode[],
  from: PanelIndexPath,
  to: { parent: PanelIndexPath; index: number },
): AbilityPanelNode[] | null {
  if (from.length === 0) return null; // 根数组不可移动
  // 防环：目标父不得是被移动节点自身或其子树（`to.parent` 以 `from` 为前缀即违规）
  if (to.parent.length >= from.length && from.every((seg, i) => to.parent[i] === seg)) return null;
  const tree = parseAbilityPanel(nodes);
  const node = panelNodeAt(tree, from);
  if (node === null) return null;
  const fromParent = from.slice(0, -1);
  const fromIndex = from[from.length - 1]!;

  // **先解析目标父再摘除源**：同一数组内摘除会让目标路径整体左移
  //（叶子父节点同步转分支）
  const target = childrenAt(tree, to.parent);
  if (target === null) return null;

  const source = childrenAt(tree, fromParent);
  if (source === null) return null;
  const [moved] = source.splice(fromIndex, 1);
  if (moved === undefined) return null;

  const at = Math.max(0, Math.min(to.index, target.length));
  target.splice(at, 0, moved);
  return parseAbilityPanel(tree);
}

/**
 * 内联警告表（`panelPathKey(索引路径) → 文案`；无问题的节点不出现在表里）。
 *
 * 两类**允许但提示**的问题（“不静默改写用户数据，由 UI 防呆”——`docs/db/schema.md` 解析口径）：
 * - 名字含 `.` → 变更记录的点分路径无法命中该节点
 * - 同层重名 → 变更记录只命中先序第一个同名节点
 */
export function panelWarningMap(nodes: readonly AbilityPanelNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (siblings: readonly AbilityPanelNode[], parentPath: readonly number[]): void => {
    const counts = new Map<string, number>();
    for (const node of siblings) counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
    siblings.forEach((node, index) => {
      const path = [...parentPath, index];
      const parts: string[] = [];
      if (node.name.includes(".")) parts.push("名字含「.」：变更记录无法定位该节点");
      if ((counts.get(node.name) ?? 0) > 1) parts.push("同层重名：变更记录只命中先序第一个");
      if (parts.length > 0) out.set(panelPathKey(path), parts.join("；"));
      if (Array.isArray(node.children)) walk(node.children, path);
    });
  };
  walk(nodes, []);
  return out;
}

/**
 * 同级拖放的**目标下标**（按“先摘后插”语义折算）：
 * 同一父且原下标在目标位之前 → 摘除后目标位整体左移一位。
 * 跨父移动无此偏移（目标数组未动）。
 */
export function siblingDropIndex(
  from: PanelIndexPath,
  target: PanelIndexPath,
  placement: "before" | "after",
): number {
  const targetIndex = target[target.length - 1] ?? 0;
  const raw = placement === "before" ? targetIndex : targetIndex + 1;
  const fromParent = from.slice(0, -1);
  const targetParent = target.slice(0, -1);
  const sameParent =
    fromParent.length === targetParent.length && fromParent.every((seg, i) => seg === targetParent[i]);
  if (sameParent && (from[from.length - 1] ?? 0) < raw) return raw - 1;
  return raw;
}

/** 面板模板（内置常量；派生 = 结构快照深拷贝，模板叶子 `value` 作为派生后的默认值） */
export interface PanelTemplate {
  id: string;
  label: string;
  panel: readonly AbilityPanelNode[];
}

/** 内置模板：覆盖「空白 / 数值化属性 / 技能树」三类常见面板起点（跨书模板库属延期项，不做） */
export const PANEL_TEMPLATES: readonly PanelTemplate[] = [
  { id: "blank", label: "空白面板", panel: [] },
  {
    id: "numeric",
    label: "数值面板（等级 + 熟练度）",
    panel: [{ name: "基础属性", children: [{ name: "等级" }, { name: "熟练度" }] }],
  },
  {
    id: "skill-tree",
    label: "技能树（分系 + 技能）",
    panel: [
      { name: "火系", children: [{ name: "火焰掌控" }, { name: "灼烧强化" }] },
      { name: "基础", children: [{ name: "体质" }, { name: "悟性" }] },
    ],
  },
];
