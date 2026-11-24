// 查询类工具：大纲侧实现（S6.3）
// get_outline / get_outline_path（「大纲查询」）
//
// db 层能力确认与分工：
// - get_outline：db readOutlineFile 返回存储形态 OutlineFileTree——
// 工具层 mapOutlineFileToTree 映射为 API 形态（camelCase），再投影成
// **分层视图**（depth 从树根算层数；卷节点带聚合）；软删节点整棵剔除
// （查询类工具不返回回收站中的对象）。不再整树返回：千章书的全树早已远超
// `TOOL_RESULT_MAX_TOKENS`，导航靠「地图（depth=1）→ 放大（volume_id）→ 检索」。
// - get_outline_path：db getOutlinePathIds 返回根 → 目标节点路径（含 root）；
// 节点不存在抛错——工具层转 null（查询无结果）；路径上任一节点软删 → null（不可见）

import { findOutlineNode, getDocumentTextLengths, getOutlinePathIds, readOutlineFile } from "@whispering233/ai-editor-db";
import { OUTLINE_STATUS, mapOutlineFileToTree } from "@whispering233/ai-editor-shared";
import type { OutlineFileNode, OutlineNode, OutlineTree } from "@whispering233/ai-editor-shared";
import type { Db } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import type { GetOutlineArgs, GetOutlinePathArgs } from "../schemas/index.js";

/**
 * 递归剔除软删节点：deleted === true 的节点整棵不可见——
 * 级联软删保证其子树已一并软删，但防御性仍剔除整棵子树
 * （手改 outline.json 可能产生不一致，查询层不因脏数据暴露回收站对象）。
 * 泛型 T 保持调用处的节点联合类型（root 层 volume|chapter，递归层逐级收窄）。
 */
function stripDeletedNodes<T extends OutlineFileNode>(nodes: readonly T[]): T[] {
  const out: T[] = [];
  for (const node of nodes) {
    if (node.deleted === true) continue;
    const children = (node as { children?: readonly OutlineFileNode[] }).children;
    out.push(children === undefined ? node : ({ ...node, children: stripDeletedNodes(children) } as T));
  }
  return out;
}

/** get_outline 层数（从树根算：1 = 卷，2 = 卷 + 章，3 = 卷 + 章 + 场景） */
export type OutlineDepth = 1 | 2 | 3;

/** 卷聚合（仅 depth=1 的卷节点；**只计未软删节点**，charCount = 正文字数，与 API `with_metadata` 的 textLength 同义） */
export interface OutlineVolumeStats {
  chapterCount: number;
  charCount: number;
  /** `data.status` = draft；缺省（未设置 / 非法值）同样计为 draft——与 UI 详情页 select 的缺省口径一致 */
  draftCount: number;
  finalCount: number;
}

/** get_outline 结果节点：API 形态去掉 `updatedAt`（模型不需要版本戳，它占原 payload 约 27%） */
export interface OutlineViewNode {
  id: string;
  type: OutlineNode["type"];
  title: string;
  summary?: string;
  data?: Record<string, unknown>;
  stats?: OutlineVolumeStats;
  children?: OutlineViewNode[];
}

/** get_outline 结果树（root 无 updatedAt；schemaVersion 原样透传） */
export interface OutlineViewTree {
  id: "root";
  type: "root";
  schemaVersion: number;
  children: OutlineViewNode[];
}

/**
 * 章 status 归一：outline.json 在读入时已解析（不经 SQL `json_extract`，无 `json_valid` 守卫问题），
 * 守卫体现为枚举白名单——缺失 / 非法值按「缺省 = 草稿」计（与 `lib/outline-detail.ts` 的
 * `defaultValue: "draft"` 同口径：手改 outline.json 的脏值不得抛错，也不得冒充定稿）。
 */
function chapterStatusOf(node: OutlineNode): string {
  const status = node.data?.["status"];
  return typeof status === "string" && (OUTLINE_STATUS as readonly string[]).includes(status) ? status : "draft";
}

/** 卷 → 聚合四数；正文字数一次批量取（勿逐卷 N+1） */
function volumeStats(chapters: readonly OutlineNode[], textLengths: Map<string, number>): OutlineVolumeStats {
  let charCount = 0;
  let draftCount = 0;
  let finalCount = 0;
  for (const chapter of chapters) {
    charCount += textLengths.get(chapter.id) ?? 0;
    const status = chapterStatusOf(chapter);
    if (status === "draft") draftCount++;
    else if (status === "final") finalCount++;
  }
  return { chapterCount: chapters.length, charCount, draftCount, finalCount };
}

/** 卷聚合（depth=1 的卷节点用）：所有卷的章 id 一次批量取正文长度，再按卷归并 */
function attachVolumeStats(db: Db, tree: OutlineTree, nodes: OutlineViewNode[]): void {
  const chaptersOf = new Map<string, OutlineNode[]>();
  for (const child of tree.children) {
    if (child.type === "volume") chaptersOf.set(child.id, child.children ?? []);
  }
  const textLengths = getDocumentTextLengths(db, "chapter", [...chaptersOf.values()].flat().map((chapter) => chapter.id));
  for (const node of nodes) {
    const chapters = chaptersOf.get(node.id);
    if (chapters !== undefined) node.stats = volumeStats(chapters, textLengths);
  }
}

/** API 形态节点 → 结果节点：砍到 depth 层、去 updatedAt（deleted/deletedAt 未删时本就是缺省值，一并丢） */
function projectNode(node: OutlineNode, levelsLeft: OutlineDepth): OutlineViewNode {
  const out: OutlineViewNode = { id: node.id, type: node.type, title: node.title };
  if (node.summary !== undefined) out.summary = node.summary;
  if (node.data !== undefined) out.data = node.data;
  const children = (node as { children?: OutlineNode[] }).children;
  if (levelsLeft > 1 && children !== undefined) {
    out.children = children.map((child) => projectNode(child, (levelsLeft - 1) as OutlineDepth));
  }
  return out;
}

/**
 * 分层大纲视图（get_outline）。
 * - depth 从树根算层数（缺省 1 = 只回卷）：千章书先看地图，再 `volume_id` 放大单卷
 * - volume_id 只过滤（只留该卷，depth 语义不变）；不存在（含已软删）→ 抛错，不静默回空树
 * - depth=1 的卷节点带聚合四数；所有档位都不返回 updatedAt
 * - 软删节点过滤（查询类工具不返回回收站对象）
 */
export function runGetOutline(ctx: ToolContext, args: GetOutlineArgs = {}): OutlineViewTree {
  const depth = args.depth ?? 1;
  const fileTree = readOutlineFile(ctx.outlineDir);
  const visible = stripDeletedNodes(fileTree.children);
  let scoped: typeof visible = visible;
  if (args.volume_id !== undefined) {
    const volume = visible.find((node) => node.id === args.volume_id && node.type === "volume");
    if (volume === undefined) throw new Error(`卷不存在：${args.volume_id}`);
    scoped = [volume];
  }
  const tree = mapOutlineFileToTree({ ...fileTree, children: scoped });
  const view: OutlineViewTree = {
    id: "root",
    type: "root",
    schemaVersion: tree.schemaVersion,
    children: tree.children.map((node) => projectNode(node, depth)),
  };
  if (depth === 1) attachVolumeStats(ctx.db, tree, view.children);
  return view;
}

/**
 * 根 → 目标节点的路径 ID 列表（get_outline_path(node_id)，含 root，
 * 如 ["root", "vol-1", "ch-3", "sc-15"]；严格三层下路径唯一）。
 * - 节点不存在 → null（db getOutlinePathIds 抛错，工具层转查询无结果）
 * - 路径上任一节点软删 → null（软删对象不可见——目标节点软删时
 * 其路径对 AI 无意义；防御手改 outline.json 产生的祖先软删不一致）
 */
export function runGetOutlinePath(ctx: ToolContext, args: GetOutlinePathArgs): string[] | null {
  const tree = readOutlineFile(ctx.outlineDir);
  let path: string[];
  try {
    path = getOutlinePathIds(tree, args.node_id);
  } catch {
    return null; // 节点不存在（getOutlinePathIds 抛错语义，见 db 注释）
  }
  for (const nodeId of path) {
    if (nodeId === "root") continue; // root 非节点，无软删概念
    const node = findOutlineNode(tree, nodeId);
    if (node?.deleted === true) return null;
  }
  return path;
}
