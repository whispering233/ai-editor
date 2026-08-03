// 分析类工具共享辅助（S6.4）：中止检查 + 实体关系图
// 纯函数模块，单一职责：被 analysis/ 各工具与测试复用，不持有状态。

import type { RelationRecord } from "@ai-editor/shared";

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
