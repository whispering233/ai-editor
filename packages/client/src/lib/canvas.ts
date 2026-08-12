// 画布纯函数（S10.1 基础 + S10.2-S10.5 画布增强批次）：节点扁平化、自动布局、localStorage
//   布局持久化（决策 10）、连线解析/过滤、连线几何（贝塞尔路径/中点/卡边框交点）、连线绘制
//   样式（语义色/粗细/透明度/箭头 marker）、小地图归一化矩形、hover 路径高亮 DFS、
//   「仅场景」过滤、错误文案映射
// 契约来源：doc/ui/pages/canvas.md（路由 #/canvas；布局持久化 localStorage key
//   ai-editor:canvas:{project_id}，按项目隔离，丢失时自动布局不视为数据异常；连线
//   plot_edge 双端点 outline_node，标签取 metadata.label）、doc/design/decisions.md
//   决策 1/10（画布是大纲同一数据的投影；坐标/缩放存浏览器 localStorage，不进数据文件）、
//   doc/api/endpoints.md「关系」（GET /relation 过滤 + POST/DELETE /relation）
// 数据流：Canvas.tsx 取数（outline store + listRelations）→ 本模块纯函数整理 → 渲染；
//   本模块不 import react / localStorage 之外的浏览器 API（localStorage 读写集中在
//   read/writeCanvasLayout 两个函数内 try/catch 容错，其余函数纯计算可单测）
import { PLOT_EDGE_TYPE } from "@whispering233/ai-editor-shared";
import type { OutlineNode, OutlineTree } from "@whispering233/ai-editor-shared";
import type { RelationSummaryItem } from "./api";

/** 画布节点类型（决策 19 严格三层；画布投影不含 root 虚拟节点） */
export type CanvasNodeType = "volume" | "chapter" | "scene";

/** 画布坐标点（canvas 坐标系：内容区左上角为原点，与缩放无关的布局坐标） */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** 节点坐标表：节点 id → 坐标 */
export type CanvasNodePositions = Record<string, CanvasPoint>;

/** 布局持久化结构（决策 10：localStorage key ai-editor:canvas:{project_id}） */
interface CanvasLayout {
  nodes: CanvasNodePositions;
  zoom: number;
}

/** 扁平化画布节点（画布渲染/自动布局输入；含直接父 id 与层级深度） */
export interface FlatCanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  summary?: string;
  /** 直接父节点 id；顶层（卷/直挂章，决策 19）为 null */
  parentId: string | null;
  /** 层级深度：卷=0、章=1、场景=2 */
  depth: number;
}

/** 画布连线（plot_edge，决策 10：outline_node → outline_node，metadata.label 存标签） */
export interface CanvasEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** 连线标签（metadata.label 非空字符串；缺省 undefined） */
  label?: string;
}

// ============ 布局/卡片尺寸常量（自动布局与卡片渲染共用单一来源） ============

/** 各类型卡片尺寸（宽 × 高；自动布局的行距/列宽以此计算，卡片渲染固定此尺寸保证布局可复现） */
export const CANVAS_CARD_W: Record<CanvasNodeType, number> = { volume: 248, chapter: 208, scene: 168 };
export const CANVAS_CARD_H: Record<CanvasNodeType, number> = { volume: 96, chapter: 88, scene: 76 };

/** 自动布局间距（canvas.md 线框：卷为容器横向成列、章缩进、场景为叶子） */
const CANVAS_LAYOUT = {
  /** 内容区左边距 */
  padX: 48,
  /** 内容区上边距 */
  padY: 48,
  /** 列间距（卷容器列宽 = 卷卡宽 + 列间距） */
  colGap: 304,
  /** 行间距（同列内卡与卡之间） */
  rowGap: 28,
  /** 章相对卷的左缩进 */
  indentChapter: 28,
  /** 场景相对卷的左缩进（章内叶子再缩进） */
  indentScene: 56,
} as const;

/** 缩放范围（决策 10：zoom 存 localStorage；按钮步进 0.1、滚轮缩放共用此范围） */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

/** localStorage 键前缀（决策 10：key = ai-editor:canvas:{project_id}，按项目隔离） */
const CANVAS_STORAGE_PREFIX = "ai-editor:canvas:";

/** 缩放值夹取到 [MIN_ZOOM, MAX_ZOOM] */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// ============ 节点扁平化（画布渲染与自动布局的统一输入） ============

/**
 * 大纲树 → 画布节点扁平列表（决策 1：同一数据的投影）。
 * 树序遍历（先序，与大纲页渲染序一致——自动布局与树的视觉序对应）；
 * 含直接父 id（顶层 null）与深度（卷=0、章=1、场景=2，决策 19 严格三层）。
 * 空树/未加载 → []。
 */
export function flattenCanvasNodes(outline: OutlineTree | null): FlatCanvasNode[] {
  if (!outline) return [];
  const acc: FlatCanvasNode[] = [];
  const walk = (children: readonly OutlineNode[], parentId: string | null, depth: number): void => {
    for (const n of children) {
      acc.push({ id: n.id, type: n.type, title: n.title, summary: n.summary, parentId, depth });
      if (n.type !== "scene" && n.children) walk(n.children, n.id, depth + 1);
    }
  };
  walk(outline.children, null, 0);
  return acc;
}

// ============ 自动布局（canvas.md：树序遍历左到右、同层自上而下；卷为容器、章缩进、场景为叶子） ============

/**
 * 自动布局：顶层（卷/直挂章）按树序从左到右成列；列内自上而下——
 *   容器卡（卷/章）占一行，场景叶子紧随其父章之下、逐行缩进排布。
 * 纯函数 + 常量尺寸 → 同输入必同输出（确定性，测试断言；丢失布局时生成初值，决策 10）。
 */
export function autoLayout(nodes: readonly FlatCanvasNode[]): CanvasNodePositions {
  const pos: CanvasNodePositions = {};
  let col = 0;
  for (const top of nodes) {
    if (top.depth !== 0) continue;
    const x = CANVAS_LAYOUT.padX + col * CANVAS_LAYOUT.colGap;
    let y = CANVAS_LAYOUT.padY;
    pos[top.id] = { x, y };
    y += CANVAS_CARD_H[top.type] + CANVAS_LAYOUT.rowGap;
    for (const child of nodes) {
      if (child.parentId !== top.id) continue;
      pos[child.id] = { x: x + CANVAS_LAYOUT.indentChapter, y };
      y += CANVAS_CARD_H[child.type] + CANVAS_LAYOUT.rowGap;
      for (const scene of nodes) {
        if (scene.parentId !== child.id) continue;
        pos[scene.id] = { x: x + CANVAS_LAYOUT.indentScene, y };
        y += CANVAS_CARD_H.scene + CANVAS_LAYOUT.rowGap;
      }
    }
    col += 1;
  }
  return pos;
}

// ============ localStorage 布局持久化（决策 10；容错：损坏/结构不符 → 丢弃走自动布局） ============

/** 项目隔离的 localStorage 键（决策 10：ai-editor:canvas:{project_id}） */
export function canvasStorageKey(projectId: string): string {
  return `${CANVAS_STORAGE_PREFIX}${projectId}`;
}

/**
 * 容错解析 localStorage 原文（纯函数，可单测）：
 * - JSON.parse 失败 / 结构不符（非对象、nodes 非对象、坐标非有限数值）→ null（丢弃走自动布局）
 * - zoom 非法（缺失/非有限数值）→ 回退 1（单独容错：布局坐标比缩放更核心）
 */
export function parseCanvasLayout(parsed: unknown): CanvasLayout | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const nodes = (parsed as { nodes?: unknown }).nodes;
  if (typeof nodes !== "object" || nodes === null || Array.isArray(nodes)) return null;
  const out: CanvasNodePositions = {};
  for (const [id, v] of Object.entries(nodes)) {
    if (typeof v !== "object" || v === null) return null;
    const p = v as { x?: unknown; y?: unknown };
    if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return null;
    }
    out[id] = { x: p.x, y: p.y };
  }
  const rawZoom = (parsed as { zoom?: unknown }).zoom;
  const zoom = typeof rawZoom === "number" && Number.isFinite(rawZoom) ? clampZoom(rawZoom) : 1;
  return { nodes: out, zoom };
}

/** 读取项目布局；无记录/JSON 损坏/结构不符 → null（丢失时调用方走自动布局，不视为数据异常） */
export function readCanvasLayout(projectId: string): CanvasLayout | null {
  try {
    const raw = localStorage.getItem(canvasStorageKey(projectId));
    if (raw === null) return null;
    return parseCanvasLayout(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** 写入项目布局（配额/隐私模式等异常静默——布局丢失可接受，决策 10） */
export function writeCanvasLayout(projectId: string, layout: CanvasLayout): void {
  try {
    localStorage.setItem(canvasStorageKey(projectId), JSON.stringify(layout));
  } catch {
    // 忽略（localStorage 不可用/配额满：布局纯展示层，丢失不影响创作数据）
  }
}

/**
 * 布局合并（树变化后保持既有坐标）：stored 有记录的节点保留（含用户拖拽结果）、
 * 缺失节点用 fallback（自动布局初值）、已不在树中的 id 丢弃（防陈旧坐标累积）。
 * 首个参数用内存态 positions（而非 localStorage）——拖拽防抖写入尚未落盘时，
 * 树重拉合并仍保留最近一次拖拽结果。
 */
export function mergeLayout(
  stored: CanvasNodePositions | null,
  fallback: CanvasNodePositions,
  nodes: readonly FlatCanvasNode[],
): CanvasNodePositions {
  const out: CanvasNodePositions = {};
  for (const n of nodes) {
    out[n.id] = stored?.[n.id] ?? fallback[n.id];
  }
  return out;
}

// ============ 连线解析/过滤（canvas.md：GET /relation 前端过滤 plot_edge + outline_node 双端点） ============

/**
 * 关系行 → 画布连线（形状防御同 S9.2 先例——查询端已按 source_type/relation_type 过滤，
 * 纯函数内再做双端校验防脏数据）：relation_type = plot_edge 且双端点均为 outline_node；
 * 标签取 metadata.label（非空字符串，首尾空格去除——与创建侧 trim 对称；其余类型/空串 → undefined）。
 * id 排序确定化。
 */
export function parsePlotEdges(relations: readonly RelationSummaryItem[]): CanvasEdge[] {
  const edges: CanvasEdge[] = [];
  for (const r of relations) {
    if (r.relationType !== PLOT_EDGE_TYPE) continue;
    if (r.sourceType !== "outline_node" || r.targetType !== "outline_node") continue;
    const rawLabel = r.metadata?.label;
    const label = typeof rawLabel === "string" && rawLabel.trim() !== "" ? rawLabel.trim() : undefined;
    edges.push({ id: r.id, sourceId: r.sourceId, targetId: r.targetId, label });
  }
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return edges;
}

/** 「仅场景」过滤（canvas.md：隐藏卷/章容器，只留 scene 叶子——连线以 scene 为主） */
export function filterSceneNodes(nodes: readonly FlatCanvasNode[]): FlatCanvasNode[] {
  return nodes.filter((n) => n.type === "scene");
}

/** 连线端点过滤：两端都在可见节点集内才保留（隐藏容器时挂到隐藏端点的连线随之隐藏） */
export function filterVisibleEdges(
  edges: readonly CanvasEdge[],
  visibleIds: ReadonlySet<string>,
): CanvasEdge[] {
  return edges.filter((e) => visibleIds.has(e.sourceId) && visibleIds.has(e.targetId));
}

// ============ 连线几何（贝塞尔曲线路径 + 中点；canvas.md：曲线 + 中点标签） ============

/**
 * 贝塞尔路径 d：水平方向出/入的控制点（dx 随端点间距自适应，最小 32px 保证小间距也有弧度）。
 * 控制点取水平（y 相同）→ 曲线在两端水平切出/切入，视觉上贴合「左→右」推演连线。
 */
export function edgePath(from: CanvasPoint, to: CanvasPoint): string {
  const dx = Math.max(32, Math.abs(to.x - from.x) * 0.5);
  const c1x = from.x + dx;
  const c2x = to.x - dx;
  return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
}

/**
 * 三次贝塞尔 t=0.5 中点（标签渲染锚点）：(P0 + 3C1 + 3C2 + P1) / 8；
 * 与 edgePath 同参数保证标签落在曲线正中。
 */
export function edgeMidpoint(from: CanvasPoint, to: CanvasPoint): CanvasPoint {
  const dx = Math.max(32, Math.abs(to.x - from.x) * 0.5);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  return {
    x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8,
    y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8,
  };
}

/** 节点卡中心坐标（连线端点锚点；卡片尺寸与自动布局共用常量） */
export function nodeCenter(pos: CanvasPoint, type: CanvasNodeType): CanvasPoint {
  return { x: pos.x + CANVAS_CARD_W[type] / 2, y: pos.y + CANVAS_CARD_H[type] / 2 };
}

/**
 * 连线端点收窄：center 卡中心 → 沿 center→other 连线与卡片边框的交点（S10.2 箭头可见——
 * 原 center-to-center 端点藏在卡片下方；t = min(半宽/|dx|, 半高/|dy|) 取先碰到的边）。
 * 两点重合（dx = dy = 0）→ 原样返回（退化连线防御，不除零）。
 */
export function edgeBorderPoint(center: CanvasPoint, other: CanvasPoint, w: number, h: number): CanvasPoint {
  const dx = other.x - center.x;
  const dy = other.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: center.x + t * dx, y: center.y + t * dy };
}

// ============ 连线绘制样式（S10.2，inkos 派生 style 模式：不注册自定义边组件，每次渲染派生样式注入） ============

/**
 * 连线语义色 hex 表（SVG 专用色值，与 token 体系共存——canvas.md「色值集中 lib/canvas.ts 常量」）：
 * 目标节点层级色（场景琥珀/章蓝/卷青，inkos TYPE_COLOR 思路）+ 高亮紫（选中/hover 路径/小地图视口框）+ 默认灰。
 */
export const EDGE_COLORS = {
  /** 高亮色（紫）：选中连线 / hover 路径边 / 小地图视口框 */
  highlight: "#a855f7",
  /** 目标为场景 → 主线色（琥珀） */
  scene: "#f59e0b",
  /** 目标为章 → 结构色（蓝） */
  chapter: "#3b82f6",
  /** 目标为卷 → 容器色（青） */
  volume: "#06b6d4",
  /** 默认灰（无目标类型信息） */
  default: "#94a3b8",
} as const;

/**
 * 连线描边颜色（三级优先级：hover 路径/选中 > 目标节点类型色 > 默认灰，canvas.md S10.2）。
 */
export function edgeStrokeColor(
  targetNodeType: CanvasNodeType | null,
  opts: { onPath?: boolean; selected?: boolean } = {},
): string {
  if (opts.onPath || opts.selected) return EDGE_COLORS.highlight;
  switch (targetNodeType) {
    case "scene":
      return EDGE_COLORS.scene;
    case "chapter":
      return EDGE_COLORS.chapter;
    case "volume":
      return EDGE_COLORS.volume;
    default:
      return EDGE_COLORS.default;
  }
}

/** 连线描边粗细：默认 1.5，选中/hover 路径 2.5（canvas.md「1.5→2.5」） */
export function edgeStrokeWidth(opts: { onPath?: boolean; selected?: boolean } = {}): number {
  return opts.onPath || opts.selected ? 2.5 : 1.5;
}

/** 连线透明度：默认 1；非路径边（hover 激活时）0.2（canvas.md「降透明」，inkos 同款） */
export function edgeOpacity(opts: { offPath?: boolean } = {}): number {
  return opts.offPath ? 0.2 : 1;
}

/** 连线箭头 marker id（SVG <defs> 定义与 path marker-end 引用共用单一来源，S10.2） */
export const EDGE_ARROW_MARKER_ID = "canvas-edge-arrow";

/** path marker-end 引用串（组件层 <marker> defs + path 引用，canvas.md S10.2「箭头」） */
export function edgeArrowMarkerEnd(): string {
  return `url(#${EDGE_ARROW_MARKER_ID})`;
}

// ============ 小地图（S10.3，纯自研：lib 纯函数计算归一化矩形，组件只渲染；MVP 只读不跳转） ============

/** 小地图固定尺寸（canvas.md：画布右下角缩略图 180×120） */
export const MINIMAP_SIZE = { w: 180, h: 120 } as const;

/** 小地图内边距（节点/视口框不贴边） */
export const MINIMAP_PAD = 4;

/** 归一化比例 clamp 上限（单节点/极小内容不放大占满小地图） */
const MINIMAP_MAX_SCALE = 1;

/** 归一化比例 clamp 下限（极大内容也不归零） */
const MINIMAP_MIN_SCALE = 0.02;

/** 小地图节点矩形（归一化坐标；type 供类型色填充） */
interface MinimapNodeRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: CanvasNodeType;
}

/**
 * 视口（渲染像素坐标：相对内容区左上角，宽高含缩放——函数内除以 zoom 还原 canvas 坐标；
 * 组件由 getBoundingClientRect 差值得出，滚动/缩放/容器尺寸变化时更新）
 */
export interface MinimapViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 小地图视口框（归一化坐标） */
interface MinimapViewportRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 小地图布局结果（组件只渲染） */
interface MinimapLayout {
  nodeRects: MinimapNodeRect[];
  viewportRect: MinimapViewportRect | null;
}

/**
 * 小地图归一化矩形：所有有坐标的可见节点包围盒等比缩放适配 MINIMAP_SIZE（居中、保比例），
 * 节点矩形与视口框同坐标系。空节点集/全部无坐标 → 空 rects + 无视口框；
 * 视口 null 或宽高非正 → 无视口框（节点矩形照常）；scale clamp 到
 * [MINIMAP_MIN_SCALE, MINIMAP_MAX_SCALE]（单节点/极小内容不放大、极大内容不归零）。
 */
export function minimapRectangles(
  nodes: readonly FlatCanvasNode[],
  positions: CanvasNodePositions,
  zoom: number,
  viewport: MinimapViewport | null,
): MinimapLayout {
  // 内容包围盒（仅取有坐标的可见节点）
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const n of nodes) {
    const pos = positions[n.id];
    if (!pos) continue;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + CANVAS_CARD_W[n.type]);
    maxY = Math.max(maxY, pos.y + CANVAS_CARD_H[n.type]);
    count += 1;
  }
  if (count === 0) return { nodeRects: [], viewportRect: null };

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const innerW = MINIMAP_SIZE.w - 2 * MINIMAP_PAD;
  const innerH = MINIMAP_SIZE.h - 2 * MINIMAP_PAD;
  // 等比缩放适配（保内容宽高比），clamp 防极端内容尺寸
  const raw = Math.min(innerW / contentW, innerH / contentH);
  const scale = Math.min(MINIMAP_MAX_SCALE, Math.max(MINIMAP_MIN_SCALE, raw));
  const offsetX = MINIMAP_PAD + (innerW - contentW * scale) / 2;
  const offsetY = MINIMAP_PAD + (innerH - contentH * scale) / 2;

  const nodeRects: MinimapNodeRect[] = [];
  for (const n of nodes) {
    const pos = positions[n.id];
    if (!pos) continue;
    nodeRects.push({
      id: n.id,
      x: offsetX + (pos.x - minX) * scale,
      y: offsetY + (pos.y - minY) * scale,
      w: CANVAS_CARD_W[n.type] * scale,
      h: CANVAS_CARD_H[n.type] * scale,
      type: n.type,
    });
  }

  let viewportRect: MinimapViewportRect | null = null;
  const z = zoom > 0 ? zoom : 1;
  if (viewport !== null && viewport.width > 0 && viewport.height > 0) {
    const vp = {
      x: viewport.x / z,
      y: viewport.y / z,
      width: viewport.width / z,
      height: viewport.height / z,
    };
    viewportRect = {
      x: offsetX + (vp.x - minX) * scale,
      y: offsetY + (vp.y - minY) * scale,
      w: vp.width * scale,
      h: vp.height * scale,
    };
  }
  return { nodeRects, viewportRect };
}

// ============ hover 路径高亮（S10.5，inkos dfsForwardPath 模式；本地 UI 态不写回数据层——决策 10 投影语义） ============

/** hover 路径高亮结果：双集合（节点 id 集 + 边 id 集，边按 CanvasEdge.id 匹配） */
interface PathHighlight {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

/**
 * 沿 plot_edge 出边（sourceId === 当前节点）向前迭代 DFS：visited 防环（无显式深度限制，
 * 画布规模小，visited 天然终止）；同 id 边防重（并行边只入栈一次）。
 * start 节点始终在 nodeIds（孤立节点 → 单节点集 + 空边集）。
 */
export function dfsForwardPath(startId: string, edges: readonly CanvasEdge[]): PathHighlight {
  const nodeIds = new Set<string>([startId]);
  const edgeIds = new Set<string>();
  const stack: string[] = [startId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.sourceId !== cur || edgeIds.has(e.id)) continue;
      edgeIds.add(e.id);
      if (!nodeIds.has(e.targetId)) {
        nodeIds.add(e.targetId);
        stack.push(e.targetId);
      }
    }
  }
  return { nodeIds, edgeIds };
}

// ============ 连线操作错误文案（canvas.md：RELATION_EXISTS → 「这条连线已经存在」；VALIDATION_ERROR → 参数问题） ============

/**
 * 连线创建/删除错误码 → toast 文案；未知错误返回 null（调用方用 err.message 兜底）。
 * 页级映射放本模块便于单测（与 relations-view 内联「这条关系已经存在」同语义，画布侧文案独立）。
 */
export function describeCanvasEdgeError(code: string | null): string | null {
  switch (code) {
    case "RELATION_EXISTS":
      return "这条连线已经存在";
    case "VALIDATION_ERROR":
      return "连线参数有误";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return null;
  }
}
