// 推演节点标记纯函数（卡片 D1）：语义与不变式见 `docs/design/10-data-model.md` §15，
// 字段契约见 `docs/db/schema.md`（project.json `deduction_nodes`）、`docs/api/10-api-project.md`（PUT /config）。
//
// **唯一编号口径** = 本模块的 `orderVisibleChapters`（可见章先序：只计未软删章、含存量直挂 root 的章、
// 软删节点的整棵子树跳过）。UI 徽标、注入文本、AI 工具三处一律消费本模块，禁止各自实现编号。
// 与服务端 `deriveChapterOrder`（含软删章、保 Delta/伏笔引用稳定）**不同源**，二者不可互相替代。
//
// **不 import zod**：纯函数，客户端可安全经 shared 根入口打包。

/** 树的最小结构视图：API 形态（OutlineTree）与存储形态（OutlineFileTree）皆可传入（字段命名差异与本模块无关） */
export interface DeductionTreeNode {
  id: string;
  type: string;
  title: string;
  deleted?: boolean;
  children?: DeductionTreeNode[];
}

/** 大纲根 children 视图（本模块只需要这一层入口） */
export interface DeductionTreeLike {
  children: DeductionTreeNode[];
}

/** 可见章（先序：卷 → 卷内章，存量直挂 root 的章按兄弟位置参与）——order/build 共用同一遍历 */
function visibleChapters(tree: DeductionTreeLike | null): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const visit = (nodes: DeductionTreeNode[]): void => {
    for (const node of nodes) {
      if (node.deleted === true) continue; // 软删节点及其整棵子树跳过
      if (node.type === "chapter") out.push({ id: node.id, title: node.title });
      if (node.children) visit(node.children);
    }
  };
  visit(tree?.children ?? []);
  return out;
}

/**
 * 可见章先序 id 列表（**唯一编号口径**：章号 = 下标 + 1）。
 * 只计未软删章；含存量直挂 root 的章；软删节点的整棵子树跳过；`null` / 空树 → `[]`。
 */
export function orderVisibleChapters(tree: DeductionTreeLike | null): string[] {
  return visibleChapters(tree).map((chapter) => chapter.id);
}

/** 推演标记角色：单标记 = `single`；多标记 = 首位 `start` / 末位 `end` / 中间 `node` */
export type DeductionMarkRole = "single" | "start" | "node" | "end";

/** 推演标记（**派生物**：库里只存 id 数组，本结构随数量与树序现算——不变式 2/3） */
export interface DeductionMark {
  nodeId: string;
  /** 标记在本次标记集合中的位置（1-based） */
  index: number;
  role: DeductionMarkRole;
 /** 徽标 / 注入文案：单标记 = `推演节点`；多标记 = `推演起点` / `推演节点 k` / `推演终点` */
  label: string;
  /** 章号（= 可见章先序位置，全书跨卷连续） */
  chapterNumber: number;
  title: string;
}

/**
 * 标记集合 → 有序推演标记（渲染 / 注入 / 工具共用的唯一形状）：
 * 过滤「树中不存在 / 已软删 / 非章」的 id（不变式 6：读侧过滤，不自动清理）→ 按可见章先序排序 →
 * 去重（顺序取树序，不取标记先后）；空集合 / 全部失效 → `[]`。
 */
export function buildDeductionMarks(
  tree: DeductionTreeLike | null,
  nodeIds: readonly string[],
): DeductionMark[] {
  // 脏数据防御：`project.json` 是用户可手编文件，`deduction_nodes` 可能是非数组（如数字）——
  // 直接 `new Set(5)` 会抛 TypeError 打挂大纲页 / AI 工具；非数组一律视为空集合（同 JSON 列防御口径）
  const wanted = new Set(Array.isArray(nodeIds) ? nodeIds : []);
 // 章号随可见章序一起带上（下标 + 1），filter 后仍是升序、天然去重
  const marked = visibleChapters(tree)
    .map((chapter, i) => ({ ...chapter, chapterNumber: i + 1 }))
    .filter((chapter) => wanted.has(chapter.id));
  const total = marked.length;
  return marked.map((chapter, i) => {
    const index = i + 1;
    const role: DeductionMarkRole =
      total === 1 ? "single" : i === 0 ? "start" : i === total - 1 ? "end" : "node";
    const label =
      role === "single"
        ? "推演节点"
        : role === "start"
          ? "推演起点"
          : role === "end"
            ? "推演终点"
            : `推演节点 ${index}`;
    return {
      nodeId: chapter.id,
      index,
      role,
      label,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
    };
  });
}
