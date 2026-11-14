// 当日码字悬浮面板的位置持久化（`localStorage` `ai-editor:stats-panel`，只存位置、不存数字；
// 契约 = DESIGN.md「当日码字悬浮面板」/ config.md 的 key 清单）。
// 坐标 = 中栏宿主矩形内的 `left/top`（宿主 = MainPanel 的 `<main>`，position: relative）。
export const STATS_PANEL_STORAGE_KEY = "ai-editor:stats-panel";
/** 面板宽度（px；与组件上的 `w-60` 同值） */
export const STATS_PANEL_WIDTH = 240;
/** 与中栏边缘的最小间距（px） */
export const STATS_PANEL_MARGIN = 8;
/** 默认槽位：入口贴在「问 AI」正上方（AI 高 40 + 16 底距 + 8 间距） */
export const STATS_PANEL_ENTRY_INSET_END = 16;
export const STATS_PANEL_ENTRY_BOTTOM = 64;

export interface StatsPanelPosition {
  left: number;
  top: number;
}

/** 矩形（宿主边界 / 面板尺寸共用形状） */
export interface StatsPanelBox {
  width: number;
  height: number;
}

/** 解析持久化值：坏 JSON / 缺字段 / 非有限 / 负数 → null（回落默认槽位） */
export function parseStatsPanelPosition(raw: string | null): StatsPanelPosition | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { left, top } = parsed as { left?: unknown; top?: unknown };
    if (typeof left !== "number" || typeof top !== "number") return null;
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    if (left < 0 || top < 0) return null;
    return { left, top };
  } catch {
    return null;
  }
}

/** 收敛到宿主内（四周 `STATS_PANEL_MARGIN`；底部预留「问 AI」槽位，避免拖到右下时被 AI 盖住） */
export function clampStatsPanelPosition(
  position: StatsPanelPosition,
  bounds: StatsPanelBox,
  size: StatsPanelBox,
): StatsPanelPosition {
  const maxLeft = Math.max(STATS_PANEL_MARGIN, bounds.width - size.width - STATS_PANEL_MARGIN);
  const maxTop = Math.max(
    STATS_PANEL_MARGIN,
    bounds.height - size.height - STATS_PANEL_ENTRY_BOTTOM,
  );
  return {
    left: Math.min(Math.max(position.left, STATS_PANEL_MARGIN), maxLeft),
    top: Math.min(Math.max(position.top, STATS_PANEL_MARGIN), maxTop),
  };
}

/** 默认槽位（right / bottom 换算成 left / top，再按边距 clamp） */
export function defaultStatsPanelPosition(
  bounds: StatsPanelBox,
  size: StatsPanelBox,
): StatsPanelPosition {
  return clampStatsPanelPosition(
    {
      left: bounds.width - size.width - STATS_PANEL_ENTRY_INSET_END,
      top: bounds.height - size.height - STATS_PANEL_ENTRY_BOTTOM,
    },
    bounds,
    size,
  );
}

/**
 * 首次放置的收敛：保存位置完整落在边距内就沿用；越界（换了小窗口 / 坏值）回落默认槽位
 * （DESIGN.md「拖动 / 持久化」：坏值 / 越界回落默认槽位；后续 resize 由 `clampStatsPanelPosition` 贴边收敛）。
 */
export function resolveStatsPanelPosition(
  saved: StatsPanelPosition | null,
  bounds: StatsPanelBox,
  size: StatsPanelBox,
): StatsPanelPosition {
  if (saved === null) return defaultStatsPanelPosition(bounds, size);
  const inside =
    saved.left >= STATS_PANEL_MARGIN &&
    saved.top >= STATS_PANEL_MARGIN &&
    saved.left <= bounds.width - size.width - STATS_PANEL_MARGIN &&
    saved.top <= bounds.height - size.height - STATS_PANEL_ENTRY_BOTTOM;
  return inside ? saved : defaultStatsPanelPosition(bounds, size);
}

/** 读取持久化位置（无 localStorage / 读取异常 / 坏值 → null） */
export function readStatsPanelPosition(): StatsPanelPosition | null {
  try {
    return parseStatsPanelPosition(globalThis.localStorage?.getItem(STATS_PANEL_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** 写入位置（存储失败静默：位置只是展示偏好） */
export function writeStatsPanelPosition(position: StatsPanelPosition): void {
  try {
    globalThis.localStorage?.setItem(STATS_PANEL_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // 无 localStorage / 隐私模式配额异常：仅本次运行内生效
  }
}