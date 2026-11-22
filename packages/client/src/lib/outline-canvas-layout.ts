// 大纲画布（`#/canvas`）的展示层纯函数（契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 五件事：
// ① `canvasChapterCards`：大纲树 → 画布卡片（**节点 = 章**，卷 / 场景不上画布）。编号与卷号消费
//    shared `numberVisibleOutline`（展示口径、只计可见节点），本模块不另算编号；卡面第三行的
//    状态 / 剧情线标签从 `node.data` 窄化（非法枚举 / 非字符串数组 = 未设置）；
// ② `layoutCanvasChapters`：**确定性网格**——缺坐标的章按其可见章序每行 `CANVAS_CHAPTERS_PER_ROW`
//    张补位（新章在可见序末尾 ⇒ 自然落在网格末尾），已有手工坐标的章不动（摆位优先）；
//    行距按行算 = 该行最高卡片（`canvasCardHeight`）+ 间距，短卡行不从高卡行借高度；
// ③ `canvasContentBounds` / `resolveInitialViewport`：首次进入（无存量视口）的落点——内容装得下就居中，
//    装不下则钳到全量档下界并从左上角起步（居中裁切会把首列卡片推出画布外）；
// ④ `canvasLodLevel`：缩放分级（全量 / far = 章名 + 数字角标）两档，阈值常量同在本模块；
// ⑤ 坐标 / 视口的 localStorage 读写（`ai-editor:canvas:{projectId}`）：展示层偏好，**不进
//    outline.json / 备份 / 云端包**（跨设备不同步是有意取舍，见 docs/design/config.md）。
//
// 写侧清理：`pruneCanvasPositions` 只留仍在可见大纲里的章（已删章 / 换书残留的条目不会越攒越多）。
// 读侧防御：坏 JSON / 形状不对 → 空状态（画布照常按网格渲染，不抛错、不阻塞页面）。
import type { OutlineStatus, OutlineTree } from "@whispering233/ai-editor-shared";
import { OUTLINE_STATUS, numberVisibleOutline } from "@whispering233/ai-editor-shared";
import { findNode } from "./outline-tree";
import { outlineTagsFromData } from "./outline-tags";

/** 网格每行的章卡片数（换行档位常量单点；调它是布局决定，不是逐页参数） */
export const CANVAS_CHAPTERS_PER_ROW = 5;
/** 卡片宽 / 高 / 间距（像素）：网格步长与卡片几何**同源**——卡片尺寸也读这里，改一处两处一起变。
 *  高度两档：状态与标签都没有 = `CANVAS_CARD_HEIGHT_BASE`（第三行不渲染、不留白），有 = `CANVAS_CARD_HEIGHT` */
export const CANVAS_CARD_WIDTH = 220;
export const CANVAS_CARD_HEIGHT_BASE = 68;
export const CANVAS_CARD_HEIGHT = 92;
export const CANVAS_CARD_GAP = 24;
/** 缩放区间（DESIGN.md：缩放 0.25–2）——MiniMap / Controls / 读侧兜底共用 */
export const CANVAS_MIN_ZOOM = 0.25;
export const CANVAS_MAX_ZOOM = 2;
/** 全量档（完整卡面）的最小缩放；更低切 far 档（26px 章名 + 数字角标） */
export const CANVAS_LOD_FULL_MIN_ZOOM = 0.72;
/**
 * 首次进入视口的缩放下界：首屏必须落在「全量」档且卡面不被压到最小——一进来就是半截卡面，
 * 等于把「缩放才分级」这件设计藏起来。比 LOD 下界高，故单独定义（不是同一个数）。
 */
export const CANVAS_INITIAL_MIN_ZOOM = 0.85;
/** 首次进入视口的四边留白（内容装不下时左上角从这里起步） */
export const CANVAS_VIEW_PADDING = 24;

/** localStorage key 前缀（按书隔离：`ai-editor:canvas:{projectId}`） */
const CANVAS_STORAGE_PREFIX = "ai-editor:canvas:";
/**
 * 存储格式版本（只活在磁盘形状里，`CanvasSavedState` 不暴露）：v3 = 卡片高度随内容 + 行距按行算。
 * v3 之前（v1 无 `version`，含更早的 `{ nodes, zoom }`；v2）读侧**整体丢弃**——旧网格的行距
 * 与新卡片高度不匹配，留着一地空洞不如一次性重排（DESIGN.md `outline-canvas`「坐标与视口」）。
 */
const CANVAS_STATE_VERSION = 3;

/** 平面坐标（与 React Flow 的 `XYPosition` 同形） */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** 视口（与 React Flow 的 `Viewport` 同形） */
export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}

/** 内容外包矩形（流坐标，含卡片自身宽高） */
export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 缩放分级档位（DESIGN.md `outline-canvas`「缩放分级（LOD）」）：全量 / far（章名 + 数字角标） */
export type CanvasLodLevel = "full" | "far";

/** 卡片高度的判据输入（第三行有无）；布局与页面共用同一处推导 */
export interface CanvasCardHeightInput {
  status?: OutlineStatus;
  tags?: readonly string[];
}

/** 卡片高度：状态与标签都没有 → 68（第三行不渲染、不留白），有 → 92 */
export function canvasCardHeight(card: CanvasCardHeightInput): number {
  const hasStatus = card.status !== undefined && card.status !== "draft";
  return hasStatus || (card.tags?.length ?? 0) > 0 ? CANVAS_CARD_HEIGHT : CANVAS_CARD_HEIGHT_BASE;
}

/** 持久化状态：手工摆位 + 视口（都缺省 = 全新画布 ⇒ 首次进入按 `resolveInitialViewport` 落点） */
export interface CanvasSavedState {
  nodes: Record<string, CanvasPoint>;
  viewport?: CanvasViewport;
}

/** 画布卡片（章级派生：编号徽标文案 + 场景数 + 第三行状态 / 标签） */
export interface CanvasChapterCard {
  id: string;
  title: string;
  /** 卷号文案（`第N卷`）；**存量直挂 root 的章** = 空串（title 里省略该段） */
  volumeLabel: string;
  /** 章号数值（1-based，与 `chapterLabel` 同源）：far 档左上角角标只显示它 */
  chapterNumber: number;
  /** 章号徽标文案（`第N章`）——全量档画布上唯一徽标 */
  chapterLabel: string;
  /** 可见场景数（软删场景不计；0 不进 title） */
  sceneCount: number;
  /** 已写（`metadata.textLength > 0`）：只给 LOD far 档的两档底色用，字数本身不上卡面 */
  written: boolean;
  /** 剧情线标签（`data.tags`；非法形状按空处理） */
  tags: string[];
  /** 写作状态（`data.status`；缺省 = 草稿，非法枚举按未设置处理） */
  status?: OutlineStatus;
}

/** 枚举字段窄化：`node.data` 是宽松 record，非法值一律按未设置处理 */
function enumField<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** 大纲树 → 画布卡片（阅读序 = 可见章先序，与行编号同源）；`null` / 空树 → 空数组 */
export function canvasChapterCards(tree: OutlineTree | null): CanvasChapterCard[] {
  const { chapters } = numberVisibleOutline(tree);
  return chapters.map((chapter) => {
    const node = findNode(tree?.children ?? [], chapter.chapterId);
    const scenes = node?.type === "chapter" ? (node.children ?? []) : [];
    // 只读章节点的 `data` / `metadata`（with_metadata=true 的联查统计）：缺省按空处理，不新增请求
    const data = node?.data ?? {};
    const status = enumField(data.status, OUTLINE_STATUS);
    return {
      id: chapter.chapterId,
      title: chapter.chapterTitle,
      volumeLabel: chapter.volumeLabel,
      chapterNumber: chapter.chapterNumber,
      chapterLabel: chapter.chapterLabel,
      sceneCount: scenes.filter((scene) => scene.deleted !== true).length,
      written: (node?.metadata?.textLength ?? 0) > 0,
      tags: outlineTagsFromData(data),
      ...(status === undefined ? {} : { status }),
    };
  });
}

/**
 * 章 id 列表 + 手工坐标 → 每张卡的位置。
 * - 有手工坐标的章：原样保留（用户摆位优先，不被网格覆盖）
 * - 缺坐标的章：网格位 = 其**可见章序**（每行 `CANVAS_CHAPTERS_PER_ROW` 张）；新章排可见序末尾 ⇒ 落网格末尾
 * - 不在列表里的 id 不入结果 ⇒ 已删章坐标自然消失（读侧清理）
 */
export function layoutCanvasChapters(
  chapters: readonly (CanvasCardHeightInput & { id: string })[],
  savedNodes: Record<string, CanvasPoint>,
): Record<string, CanvasPoint> {
  const positions: Record<string, CanvasPoint> = {};
  let y = 0;
  for (let start = 0; start < chapters.length; start += CANVAS_CHAPTERS_PER_ROW) {
    const row = chapters.slice(start, start + CANVAS_CHAPTERS_PER_ROW);
    row.forEach((chapter, column) => {
      positions[chapter.id] = savedNodes[chapter.id] ?? {
        x: column * (CANVAS_CARD_WIDTH + CANVAS_CARD_GAP),
        y,
      };
    });
    // 行距按行算：该行最高卡片 + 间距（全短行 92、含高卡 116）
    y += Math.max(...row.map(canvasCardHeight)) + CANVAS_CARD_GAP;
  }
  return positions;
}

/** 缩放到档位（阈值单源在本模块：`>= 0.72` 全量、更低 far（章名 + 数字角标）） */
export function canvasLodLevel(zoom: number): CanvasLodLevel {
  return zoom >= CANVAS_LOD_FULL_MIN_ZOOM ? "full" : "far";
}

/**
 * 全部卡片的外包矩形（流坐标，含**每张卡自己的高度**；零章 → `null`）。
 * 只读摆位、不读 DOM 尺寸——卡片宽高是常量，逐卡高度由 `canvasCardHeight` 判定。
 */
export function canvasContentBounds(
  positions: Record<string, CanvasPoint>,
  cards: readonly (CanvasCardHeightInput & { id: string })[],
): CanvasBounds | null {
  const entries = Object.entries(positions);
  if (entries.length === 0) return null;
  const heights = new Map(cards.map((card) => [card.id, canvasCardHeight(card)]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [id, point] of entries) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x + CANVAS_CARD_WIDTH);
    maxY = Math.max(maxY, point.y + (heights.get(id) ?? CANVAS_CARD_HEIGHT_BASE));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 首次进入（无存量视口）的落点：
 * - 内容装得下（`zoom >= CANVAS_INITIAL_MIN_ZOOM`）→ **居中**；上界 1 ⇒ 1–2 章的小书不放大到满屏；
 * - 装不下 → 缩放钳到 `CANVAS_INITIAL_MIN_ZOOM` 并**定位到内容左上角 + 留白**（居中裁切会把首列卡片
 *   推出画布外，故不居中）；
 * - 没有内容 / 画布尺寸未就绪 → 中性缺省 `(0, 0, 1)`（不猜落点，等下一帧拿到真实尺寸）。
 */
export function resolveInitialViewport(
  bounds: CanvasBounds | null,
  canvas: { width: number; height: number },
): CanvasViewport {
  if (bounds === null || canvas.width <= 0 || canvas.height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }
  const fitZoom = Math.min(
    1,
    (canvas.width - CANVAS_VIEW_PADDING * 2) / bounds.width,
    (canvas.height - CANVAS_VIEW_PADDING * 2) / bounds.height,
  );
  if (fitZoom >= CANVAS_INITIAL_MIN_ZOOM) {
    return {
      x: (canvas.width - bounds.width * fitZoom) / 2 - bounds.x * fitZoom,
      y: (canvas.height - bounds.height * fitZoom) / 2 - bounds.y * fitZoom,
      zoom: fitZoom,
    };
  }
  const zoom = CANVAS_INITIAL_MIN_ZOOM;
  return {
    x: CANVAS_VIEW_PADDING - bounds.x * zoom,
    y: CANVAS_VIEW_PADDING - bounds.y * zoom,
    zoom,
  };
}

/** 只保留仍在可见大纲里的章坐标（写侧清理：已删章 / 换书残留的条目） */
export function pruneCanvasPositions(
  chapters: readonly { id: string }[],
  savedNodes: Record<string, CanvasPoint>,
): Record<string, CanvasPoint> {
  const visible = new Set(chapters.map((chapter) => chapter.id));
  return Object.fromEntries(
    Object.entries(savedNodes).filter(([id]) => visible.has(id)),
  ) as Record<string, CanvasPoint>;
}

/** localStorage key（按书隔离；`#/canvas` 一直在同一本书内切换） */
export function canvasStorageKey(projectId: string): string {
  return `${CANVAS_STORAGE_PREFIX}${projectId}`;
}

/** 坐标形状校验（坏条目丢弃：NaN / 字符串 / 缺字段一律不认） */
function toPoint(value: unknown): CanvasPoint | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 视口形状校验 + 缩放夹到 `CANVAS_MIN_ZOOM`–`CANVAS_MAX_ZOOM`（旧值越界也读得回来） */
function toViewport(value: unknown): CanvasViewport | null {
  const point = toPoint(value);
  if (point === null) return null;
  const zoom = (value as Record<string, unknown>).zoom;
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return null;
  return { ...point, zoom: Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom)) };
}

/**
 * 解析持久化状态（`null` = 没存过）。
 * 坏 JSON / 非对象 / 坐标形状不对 → 空状态；**v3 之前（v1 无 `version`、v2）整体丢弃**
 * （nodes 空、无 viewport）：一次重排，而不是留着与新行距不匹配的旧网格。
 */
export function parseCanvasState(raw: string | null): CanvasSavedState {
  if (raw === null) return { nodes: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { nodes: {} };
  }
  if (typeof parsed !== "object" || parsed === null) return { nodes: {} };
  const record = parsed as Record<string, unknown>;
  if (record.version !== CANVAS_STATE_VERSION) return { nodes: {} };
  const nodes: Record<string, CanvasPoint> = {};
  if (typeof record.nodes === "object" && record.nodes !== null) {
    for (const [id, value] of Object.entries(record.nodes)) {
      const point = toPoint(value);
      if (point !== null) nodes[id] = point;
    }
  }
  const viewport = toViewport(record.viewport);
  return viewport === null ? { nodes } : { nodes, viewport };
}

/** 读本书的持久化状态：**未打开项目（`projectId = null`）不读**，坐标只在内存里摆 */
export function readCanvasState(projectId: string | null): CanvasSavedState {
  if (projectId === null) return { nodes: {} };
  try {
    return parseCanvasState(localStorage.getItem(canvasStorageKey(projectId)));
  } catch {
    return { nodes: {} }; // 存储不可用（隐私模式 / SSR）：退化成「不记住坐标」
  }
}

/** 写本书的持久化状态：未打开项目不写；写失败（配额 / 隐私模式）静默——坐标只是展示偏好 */
export function writeCanvasState(projectId: string | null, state: CanvasSavedState): void {
  if (projectId === null) return;
  try {
    const payload = {
      version: CANVAS_STATE_VERSION,
      nodes: state.nodes,
      ...(state.viewport === undefined ? {} : { viewport: state.viewport }),
    };
    localStorage.setItem(canvasStorageKey(projectId), JSON.stringify(payload));
  } catch {
    /* 同上：不因展示偏好写失败打断画布 */
  }
}
