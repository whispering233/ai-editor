// 查询类工具：大纲侧实现（S6.3）
// get_outline / get_outline_path / search_outline（「大纲查询」）
//
// db 层能力确认与分工：
// - get_outline：db readOutlineFile 返回存储形态 OutlineFileTree——
// 工具层 mapOutlineFileToTree 映射为 API 形态（camelCase），再投影成
// **分层视图**（depth 从树根算层数；卷节点带聚合）；软删节点整棵剔除
// （查询类工具不返回回收站中的对象）。不再整树返回：千章书的全树早已远超
// `TOOL_RESULT_MAX_TOKENS`，导航靠「地图（depth=1）→ 放大（volume_id）→ 检索」。
// - get_outline_path：db getOutlinePathIds 返回根 → 目标节点路径（含 root）；
// 节点不存在抛错——工具层转 null（查询无结果）；路径上任一节点软删 → null（不可见）
// - search_outline：全文检索落在 outline.json（卷/章/场景一棵树，无表）——不经 FTS5 也不开迁移，
// 千章全树扫描是 ms 级；阅读序与章号一律取 db deriveChapterOrder（**不再另写一套遍历**）

import { deriveChapterOrder, findOutlineNode, getDocumentTextLengths, getOutlinePathIds, readOutlineFile } from "@whispering233/ai-editor-db";
import { mapOutlineFileToTree, OUTLINE_STATUS } from "@whispering233/ai-editor-shared";
import type { OutlineFileChapter, OutlineFileNode, OutlineFileTree, OutlineNode, OutlineStatus, OutlineTree } from "@whispering233/ai-editor-shared";
import type { Db } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import type { GetOutlineArgs, GetOutlinePathArgs, SearchOutlineArgs } from "../schemas/index.js";

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

// ============ search_outline ============

/**
 * search_outline 单页条数上限（分页口径与 search_entities 同构：total / truncated / next_offset）。
 * 单项 ≈ 标题 + 片段（≤ 2 × 窗宽 + 省略号），整页连 JSON 信封仍远低于单条工具结果预算。
 */
export const MAX_OUTLINE_SEARCH_LIMIT = 50;

/** 片段窗宽：命中位置**前后各取**的字符数（省略号另计，见 `snippetOf`） */
export const OUTLINE_SEARCH_SNIPPET_CHARS = 30;

/** search_outline 结果项（章；卷 / 场景不上结果——见 `runSearchOutline` 注释） */
export interface OutlineSearchItem {
  id: string;
  title: string;
  /** 全局章号（阅读序，来源 = db deriveChapterOrder，与 get_chapter_text 的 chapter_number 同口径） */
  chapterNumber: number;
  /** 所属卷 id；存量直挂 root 的章 = ""（同 shared numberVisibleOutline 口径） */
  volumeId: string;
  /** 所属卷标题；存量直挂 root 的章 = "" */
  volumeTitle: string;
  /** 写作状态；`data.status` 缺省 / 未知值 = draft（缺省即草稿，见 10-data-model §8） */
  status: OutlineStatus;
  tags: string[];
  snippet: string;
}

/** search_outline 结果：命中页 + 命中总数；未取完时附续页信息（字段稀疏，取完不出现） */
export interface SearchOutlineResult {
  items: OutlineSearchItem[];
  total: number;
  /** true = 后面还有未返回的命中（items 不完整） */
  truncated?: boolean;
  /** 下一页的 offset（仅 truncated = true 时出现） */
  next_offset?: number;
}

/** 可见章索引项：章节点 + 所属卷归属（直挂 root 的章两项为空串） */
interface VisibleChapter {
  node: OutlineFileChapter;
  volumeId: string;
  volumeTitle: string;
}

/**
 * 可见章索引（软删节点整棵不进索引——卷软删时其章也随级联不可见，畸形树同此防御）。
 * 只收章：卷 / 场景没有章号与写作状态，检索面的每一项都要「第 N 章 + 所属卷」。
 */
function indexVisibleChapters(tree: OutlineFileTree): Map<string, VisibleChapter> {
  const index = new Map<string, VisibleChapter>();
  for (const child of tree.children) {
    if (child.deleted === true) continue;
    if (child.type === "chapter") {
      index.set(child.id, { node: child, volumeId: "", volumeTitle: "" });
      continue;
    }
    for (const chapter of child.children ?? []) {
      if (chapter.type !== "chapter" || chapter.deleted === true) continue;
      index.set(chapter.id, { node: chapter, volumeId: child.id, volumeTitle: child.title });
    }
  }
  return index;
}

/** 章写作状态：缺省 / 脏值按 draft（缺省即草稿，与客户端表单归一一致） */
function chapterStatus(data: Record<string, unknown>): OutlineStatus {
  const raw = data.status;
  return typeof raw === "string" && (OUTLINE_STATUS as readonly string[]).includes(raw)
    ? (raw as OutlineStatus)
    : "draft";
}

/** 章标签（脏值容错：非数组 / 非字符串项一律忽略） */
function chapterTags(data: Record<string, unknown>): string[] {
  const raw = data.tags;
  return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === "string" && tag !== "") : [];
}

/**
 * 片段：命中位置前后各取 `OUTLINE_SEARCH_SNIPPET_CHARS` 字，切掉的部分补省略号。
 * `query` 为空（只给结构化过滤）时取文本开头一屏——与命中场景同一窗宽，输出长度可预期。
 */
function snippetOf(text: string, query: string): string {
  const hit = query === "" ? 0 : text.toLowerCase().indexOf(query.toLowerCase());
  const from = Math.max(0, hit - OUTLINE_SEARCH_SNIPPET_CHARS);
  const to = Math.min(text.length, hit + query.length + OUTLINE_SEARCH_SNIPPET_CHARS);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/**
 * 大纲检索（search_outline(query?, status?, tags?, volume_id?, offset?) → 命中章分页）。
 * - **至少一个条件**：四个条件全空 → 抛错（本工具不承担「列全书」，那会把整棵树的标题灌进上下文）
 * - 命中面 = `title` / `summary`（计划摘要）/ `data.result_summary`（实际摘要）；子串匹配
 *   （大小写不敏感，同 LIKE 语义；数据在 outline.json 里，不值得为 5–9ms 的全表扫上 FTS5）
 * - status / tags 为结构化过滤：tags **全含**（与 db `listEntities` 的 filters 同口径）
 * - 排序 + 章号 = db `deriveChapterOrder`（阅读序：卷序 → 卷内章序；工具层不再自排）
 * - 软删章不出现（可见章索引，见 `indexVisibleChapters`）
 */
export function runSearchOutline(ctx: ToolContext, args: SearchOutlineArgs): SearchOutlineResult {
  const query = args.query?.trim() ?? "";
  const tags = (args.tags ?? []).filter((tag) => tag !== "");
  if (query === "" && args.status === undefined && tags.length === 0 && args.volume_id === undefined) {
    throw new Error(
      "search_outline 至少需要一个条件（query / status / tags / volume_id）——本工具不用于列出全书；看整体结构请用 get_outline",
    );
  }

  const index = indexVisibleChapters(readOutlineFile(ctx.outlineDir));
  const lowerQuery = query.toLowerCase();
  const matched: OutlineSearchItem[] = [];
  // 阅读序单源：deriveChapterOrder 已是先序升序（含软删章的号位），按它的顺序逐章判定/收集
  for (const { chapterId, chapterNumber } of deriveChapterOrder(ctx.outlineDir)) {
    const entry = index.get(chapterId);
    if (entry === undefined) continue; // 软删 / 无归属（畸形树）→ 不可见
    const data = entry.node.data ?? {};
    const status = chapterStatus(data);
    if (args.status !== undefined && status !== args.status) continue;
    const nodeTags = chapterTags(data);
    if (tags.length > 0 && !tags.every((tag) => nodeTags.includes(tag))) continue;
    if (args.volume_id !== undefined && entry.volumeId !== args.volume_id) continue;
    const summary = entry.node.summary ?? "";
    const resultSummary = typeof data.result_summary === "string" ? data.result_summary : "";
    // 命中面 = 标题 / 计划摘要 / 实际摘要；无 query（只给结构化过滤）时片段取后两者之一，再回落标题
    const texts = [entry.node.title, summary, resultSummary];
    const hit =
      query === ""
        ? (texts.slice(1).find((text) => text !== "") ?? entry.node.title)
        : texts.find((text) => text.toLowerCase().includes(lowerQuery));
    if (hit === undefined) continue;
    matched.push({
      id: entry.node.id,
      title: entry.node.title,
      chapterNumber,
      volumeId: entry.volumeId,
      volumeTitle: entry.volumeTitle,
      status,
      tags: nodeTags,
      snippet: snippetOf(hit, query),
    });
  }

  const offset = Math.max(0, Math.trunc(args.offset ?? 0));
  const items = matched.slice(offset, offset + MAX_OUTLINE_SEARCH_LIMIT);
  const nextOffset = offset + items.length;
  return nextOffset < matched.length
    ? { items, total: matched.length, truncated: true, next_offset: nextOffset }
    : { items, total: matched.length };
}
