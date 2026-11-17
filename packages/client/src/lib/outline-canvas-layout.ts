// 大纲画布（`#/canvas`）的展示层纯函数（契约：docs/ui/DESIGN.md `outline-canvas`）。
//
// 三件事：
// ① `canvasChapterCards`：大纲树 → 画布卡片（**节点 = 章**，卷 / 场景不上画布）。编号与卷号消费
//    shared `numberVisibleOutline`（展示口径、只计可见节点），本模块不另算编号；
// ② `layoutCanvasChapters`：**确定性网格**——缺坐标的章按其可见章序每行 `CANVAS_CHAPTERS_PER_ROW`
//    张补位（新章在可见序末尾 ⇒ 自然落在网格末尾），已有手工坐标的章不动（摆位优先）；
// ③ 坐标 / 视口的 localStorage 读写（`ai-editor:canvas:{projectId}`）：展示层偏好，**不进
//    outline.json / 备份 / 云端包**（跨设备不同步是有意取舍，见 docs/design/config.md）。
//
// 写侧清理：`pruneCanvasPositions` 只留仍在可见大纲里的章（已删章 / 换书残留的条目不会越攒越多）。
// 读侧防御：坏 JSON / 形状不对 → 空状态（画布照常按网格渲染，不抛错、不阻塞页面）。
import type { OutlineTree } from "@whispering233/ai-editor-shared";
import { numberVisibleOutline } from "@whispering233/ai-editor-shared";
import { findNode } from "./outline-tree";

/** 网格每行的章卡片数（换行档位常量单点；调它是布局决定，不是逐页参数） */
export const CANVAS_CHAPTERS_PER_ROW = 8;
/** 卡片宽 / 高 / 间距（像素）：网格步长与卡片几何**同源**——卡片尺寸也读这里，改一处两处一起变 */
export const CANVAS_CARD_WIDTH = 220;
export const CANVAS_CARD_HEIGHT = 84;
export const CANVAS_CARD_GAP = 24;
/** 缩放区间（DESIGN.md：缩放 0.25–2）——MiniMap / Controls / 读侧兜底共用 */
export const CANVAS_MIN_ZOOM = 0.25;
export const CANVAS_MAX_ZOOM = 2;

/** localStorage key 前缀（按书隔离：`ai-editor:canvas:{projectId}`） */
const CANVAS_STORAGE_PREFIX = "ai-editor:canvas:";

/** 平面坐标（与 React Flow 的 `XYPosition` 同形） */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** 视口（与 React Flow 的 `Viewport` 同形） */
export interface CanvasViewport extends CanvasPoint {
  zoom: number;
}

/** 持久化状态：手工摆位 + 视口（都缺省 = 全新画布 ⇒ 首次进入 fitView） */
export interface CanvasSavedState {
  nodes: Record<string, CanvasPoint>;
  viewport?: CanvasViewport;
}

/** 画布卡片（章级派生：编号徽标文案 + 场景数） */
export interface CanvasChapterCard {
  id: string;
  title: string;
  /** 卷号徽标文案（`第N卷`）；**存量直挂 root 的章** = 空串（调用方不渲染该徽标） */
  volumeLabel: string;
  /** 章号徽标文案（`第N章`） */
  chapterLabel: string;
  /** 可见场景数（软删场景不计；0 不渲染） */
  sceneCount: number;
}

/** 大纲树 → 画布卡片（阅读序 = 可见章先序，与行编号同源）；`null` / 空树 → 空数组 */
export function canvasChapterCards(tree: OutlineTree | null): CanvasChapterCard[] {
  const { chapters } = numberVisibleOutline(tree);
  return chapters.map((chapter) => {
    const node = findNode(tree?.children ?? [], chapter.chapterId);
    const scenes = node?.type === "chapter" ? (node.children ?? []) : [];
    return {
      id: chapter.chapterId,
      title: chapter.chapterTitle,
      volumeLabel: chapter.volumeLabel,
      chapterLabel: chapter.chapterLabel,
      sceneCount: scenes.filter((scene) => scene.deleted !== true).length,
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
  chapters: readonly { id: string }[],
  savedNodes: Record<string, CanvasPoint>,
): Record<string, CanvasPoint> {
  const positions: Record<string, CanvasPoint> = {};
  chapters.forEach((chapter, index) => {
    positions[chapter.id] = savedNodes[chapter.id] ?? {
      x: (index % CANVAS_CHAPTERS_PER_ROW) * (CANVAS_CARD_WIDTH + CANVAS_CARD_GAP),
      y: Math.floor(index / CANVAS_CHAPTERS_PER_ROW) * (CANVAS_CARD_HEIGHT + CANVAS_CARD_GAP),
    };
  });
  return positions;
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
 * 坏 JSON / 非对象 / 坐标形状不对 → 空状态；**旧格式 `{ nodes, zoom }`**（旧画布只记缩放）：
 * 视口 = `(0, 0, zoom)`，坐标照常读。
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
  const nodes: Record<string, CanvasPoint> = {};
  if (typeof record.nodes === "object" && record.nodes !== null) {
    for (const [id, value] of Object.entries(record.nodes)) {
      const point = toPoint(value);
      if (point !== null) nodes[id] = point;
    }
  }
  const viewport = toViewport(record.viewport) ?? toViewport({ x: 0, y: 0, zoom: record.zoom });
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
    localStorage.setItem(canvasStorageKey(projectId), JSON.stringify(state));
  } catch {
    /* 同上：不因展示偏好写失败打断画布 */
  }
}
