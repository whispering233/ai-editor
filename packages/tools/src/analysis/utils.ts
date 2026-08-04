// 分析类工具共享辅助（S6.4/S6.5）：中止检查 + 实体关系图 + 章节序索引
// 纯函数模块，单一职责：被 analysis/ 各工具与测试复用，不持有状态。

import { deriveChapterOrder, findOutlineNode, readOutlineFile, readProjectFile } from "@whispering233/ai-editor-db";
import type { OutlineFileNode, OutlineFileTree, RelationRecord } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";

/**
 * 工具取消专用错误（决策 16 ③）：signal 中止时抛出。
 * name = "AbortError"（与 DOMException 同名约定）——S7.4 executor 据此区分
 * 「SSE 断开取消」（**不喂回 LLM、不计失败轮**）与「工具执行失败」（结构化喂回 LLM 自纠）。
 */
export class AbortedError extends Error {
  constructor(message = "工具执行已中止（aborted）") {
    super(message);
    this.name = "AbortError";
  }
}

/**
 * 中止检查（决策 16 ③「长工具执行中检查 signal」）：
 * 分析工具是长任务候选（全量关系/Delta 遍历），在循环中周期性调用——
 * signal 已中止即抛 AbortedError（executor 捕获后按取消处理，不产生部分结果）。
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new AbortedError();
  }
}

/** 实体端点判定（relation 端点类型：character/setting/location/hook 为实体，outline_node 为大纲节点） */
export function isEntityType(type: string): boolean {
  return type === "character" || type === "setting" || type === "location" || type === "hook";
}

/**
 * 无向实体邻接图：从可见关系构建「实体 id → 邻居实体 id 集合」。
 * 只保留两端均为实体的边（appears_in 等指向大纲节点的关系不参与实体连通性）；
 * 自环（source === target）忽略。供 detect_conflicts（对称缺失检测）与
 * suggest_connections（共同邻居信号）复用。
 */
export function buildEntityGraph(relations: readonly RelationRecord[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    let neighbors = graph.get(a);
    if (neighbors === undefined) {
      neighbors = new Set();
      graph.set(a, neighbors);
    }
    neighbors.add(b);
  };
  for (const r of relations) {
    if (!isEntityType(r.sourceType) || !isEntityType(r.targetType)) continue;
    addEdge(r.sourceId, r.targetId);
    addEdge(r.targetId, r.sourceId); // 无向：双向登记
  }
  return graph;
}

/** 两集合交集元素（保持第一个集合的迭代序；供共享场景/共同邻居信号使用） */
export function intersectSets<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): T[] {
  const out: T[] = [];
  for (const v of a) {
    if (b.has(v)) out.push(v);
  }
  return out;
}

// ============ 章节序索引（S6.5，决策 21 口径） ============

/**
 * 章节序索引：一次读树 + 推导章节序，供工具内多次「节点 → 章序号」查询。
 * 口径（决策 21）：全局**章**序号（跨卷连续累计），root → 卷 → 章先序遍历，
 * scene 归入所属 chapter 不单独编号；节点 move 后下次构建自动更新（不落库、查询时现推）。
 * **软删可见性（决策 12）**：软删节点视为不可见——chapterOf 返回 null（供伏笔指标/
 * 活跃度等判定；级联软删保证其子树一并软删，无需逐祖先检查）。
 */
export interface ChapterIndex {
  /** 节点 id → 全局章序号（scene 归入所属章、chapter 取自身；volume/root/不存在/**软删** → null） */
  chapterOf(nodeId: string): number | null;
  /**
   * 当前章节（决策 21/hooks.md「当前章节」= project.json 的 current_position 所属章——
   * 写作进度而非规划终点，与伏笔/孤儿工具口径一致）：
   * 1. current_position 已设置且可推导章号 → 该章序号
   * 2. 未设置/节点不存在/无章号 → 退化树末章（合理默认）
   */
  currentChapter: number | null;
}

/**
 * 构建章节序索引（决策 21）。节点所属章查找：chapter 取自身序号；scene 沿父链
 * 向上找最近 chapter（严格三层下即其父）。读一次 outline.json 支撑全量查询，
 * 避免 N 次文件读取（getChapterNumber 逐次读文件）。
 */
export function buildChapterIndex(ctx: ToolContext): ChapterIndex {
  const tree = readOutlineFile(ctx.outlineDir);
  const order = deriveChapterOrder(ctx.outlineDir);
  const chapterNumbers = new Map(order.map((c) => [c.chapterId, c.chapterNumber]));
  // 软删节点集合（决策 12：不可见 → 无章号）
  const deletedNodeIds = new Set<string>();
  // 节点 id → 父节点 id（scene → chapter 归属链）
  const parentOf = new Map<string, string>();
  const visit = (nodes: readonly OutlineFileNode[], parentId: string): void => {
    for (const node of nodes) {
      parentOf.set(node.id, parentId);
      if (node.deleted === true) deletedNodeIds.add(node.id);
      const children = (node as { children?: readonly OutlineFileNode[] }).children;
      if (children !== undefined) visit(children, node.id);
    }
  };
  visit(tree.children, "root");

  const chapterOf = (nodeId: string): number | null => {
    if (deletedNodeIds.has(nodeId)) return null; // 软删节点不可见（决策 12）
    // 自身是章
    const self = chapterNumbers.get(nodeId);
    if (self !== undefined) return self;
    // 沿父链向上找章（scene → chapter；volume/root 无章号）
    let cur: string | undefined = nodeId;
    for (let depth = 0; depth < 4 && cur !== undefined; depth++) {
      cur = parentOf.get(cur);
      if (cur === undefined) return null;
      const n = chapterNumbers.get(cur);
      if (n !== undefined) return n;
    }
    return null;
  };

  // 当前章节：current_position 优先（决策 21），退化树末章
  let currentChapter: number | null = null;
  const config = readProjectFile(ctx.outlineDir);
  if (config !== null && config.current_position !== null && config.current_position !== "") {
    currentChapter = chapterOf(config.current_position);
  }
  if (currentChapter === null) {
    currentChapter = order.length > 0 ? order[order.length - 1].chapterNumber : null;
  }

  return { chapterOf, currentChapter };
}

/** 大纲节点名称（title；节点不存在 → id 占位——脏引用防御） */
export function outlineNodeName(tree: OutlineFileTree, nodeId: string): string {
  const node = findOutlineNode(tree, nodeId);
  return node === undefined ? nodeId : node.title;
}
