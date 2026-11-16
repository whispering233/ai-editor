// 大纲页树栏（rail）宽度与收起态 hook（DESIGN.md `outline-page`「宽度与收起」）：
// - 桌面态（≥1024px）默认宽度 = max(320px, 中栏 1/3)：写成 CSS（`width` 的百分比按 flex 容器解析），
//   布局自己算，不测中栏像素；**首次拖拽后**才变像素值
// - 拖拽区间 280–600px，可收起为 0px（宽度保留、展开恢复）；窄屏全宽，不吃这两个值
// - 宽度与收起态持久化 localStorage（key ai-editor:outline-rail，全局一份、不随书）
// - 拖拽期间（moveResize）只更新内存态，结束（endResize）时一次写入 localStorage
// - 纯函数（parseOutlineRailLayout）从 hook 抽出供测试；hook 本体依赖 window，SSR 回退默认
import { useEffect, useRef, useState } from "react";
import { clampPanelWidth } from "./use-panels";

/** localStorage key（唯一 key，勿手抄字面量） */
export const OUTLINE_RAIL_STORAGE_KEY = "ai-editor:outline-rail";
/** 默认宽度（尚未拖拽过）：中栏 1/3，保底 320px */
export const OUTLINE_RAIL_DEFAULT_WIDTH_CSS = "max(320px, calc(100% / 3))";
/** 拖拽下限（320px 稿纸上标题 / 摘要仍可读） */
export const OUTLINE_RAIL_MIN_WIDTH = 280;
/** 拖拽上限（再宽挤压详情列） */
export const OUTLINE_RAIL_MAX_WIDTH = 600;

export interface OutlineRailLayout {
  /** 像素宽度；null = 未拖拽过的默认宽度（见 `OUTLINE_RAIL_DEFAULT_WIDTH_CSS`） */
  width: number | null;
  collapsed: boolean;
}

/** 默认布局（无持久化 / 解析失败时） */
export function defaultOutlineRailLayout(): OutlineRailLayout {
  return { width: null, collapsed: false };
}

/**
 * 解析持久化 JSON（localStorage 防御）：
 * - null / 空串 / 非法 JSON / 非对象 / 数组 → 整体回退默认
 * - 宽度缺失 / 非有限数值 → 回到默认宽度（只丢宽度，不丢收起态）；越界按 [min, max] 取整收敛
 * - 收起态仅严格 true 生效（其他值按 false）
 */
export function parseOutlineRailLayout(raw: string | null): OutlineRailLayout {
  if (!raw) return defaultOutlineRailLayout();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultOutlineRailLayout();
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return defaultOutlineRailLayout();
  const rec = data as Record<string, unknown>;
  const width = rec.width;
  return {
    width:
      typeof width === "number" && Number.isFinite(width)
        ? clampPanelWidth(width, OUTLINE_RAIL_MIN_WIDTH, OUTLINE_RAIL_MAX_WIDTH)
        : null,
    collapsed: rec.collapsed === true,
  };
}

/** 安全读取 localStorage（隐私模式 / SSR 等异常 → null 回退默认） */
function readStorage(): string | null {
  if (typeof window === "undefined") return null; // SSR / node 环境防御（同 use-writing-rail）
  try {
    return window.localStorage.getItem(OUTLINE_RAIL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 写入 localStorage（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStorage(layout: OutlineRailLayout): void {
  try {
    window.localStorage.setItem(OUTLINE_RAIL_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // 忽略：纯展示层偏好，写失败不影响功能
  }
}

/**
 * rail 状态 hook：宽度（CSS 默认值或像素）+ 收起态，localStorage 持久化。
 * 拖拽采用「起始快照 + 增量」模型：startResize 记录起点与起始宽（默认宽度要量一次 DOM），
 * moveResize 每帧只更新内存态，endResize 用 dragRef 的 lastX 算最终宽度并一次写入存储。
 * desktop 仅用于跨断点兜底：拖拽中视口缩到 <1024px 时手柄卸载、pointerup 不再到达它。
 */
export function useOutlineRail(desktop: boolean) {
  const [layout, setLayout] = useState<OutlineRailLayout>(() =>
    parseOutlineRailLayout(readStorage()),
  );
  const [resizing, setResizing] = useState(false);
  /** rail 元素（默认宽度是 CSS 值，拖拽起点要读它的实际像素宽） */
  const railRef = useRef<HTMLElement | null>(null);
  // 拖拽起点快照（pointerdown 记录；move/up 期间由手柄持续回调，移出窗口也不丢事件）
  const dragRef = useRef<{ startX: number; startWidth: number; lastX: number } | null>(null);

  // 跨断点清理（同 use-writing-rail）：拖拽中视口缩到 <1024px ⇒ 手柄卸载、pointerup 不再到达手柄；
  // 兜底清拖拽态，避免根容器 select-none 永久生效。
  useEffect(() => {
    if (!desktop && dragRef.current !== null) {
      dragRef.current = null;
      setResizing(false);
    }
  }, [desktop]);

  /** 拖拽宽度计算：起点 + 增量（手柄 = rail 右边界，右拖变宽），静态 [min, max] 收敛 */
  function dragWidth(drag: NonNullable<typeof dragRef.current>): number {
    return clampPanelWidth(
      drag.startWidth + (drag.lastX - drag.startX),
      OUTLINE_RAIL_MIN_WIDTH,
      OUTLINE_RAIL_MAX_WIDTH,
    );
  }

  /** 开始拖拽（手柄 pointerdown）：量出当前渲染宽作起点，标记拖拽中（页面据此禁文本选择） */
  function startResize(clientX: number) {
    const startWidth =
      railRef.current?.getBoundingClientRect().width ?? OUTLINE_RAIL_MIN_WIDTH;
    dragRef.current = { startX: clientX, startWidth, lastX: clientX };
    setResizing(true);
  }

  /** 拖拽中（手柄 pointermove）：增量更新内存态，不写 localStorage */
  function moveResize(clientX: number) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.lastX = clientX;
    const width = dragWidth(drag);
    setLayout((prev) => ({ ...prev, width }));
  }

  /** 拖拽结束（手柄 pointerup / pointercancel）：取最新宽度一次写入存储，清拖拽态 */
  function endResize() {
    const drag = dragRef.current;
    if (!drag) return;
    const width = dragWidth(drag);
    dragRef.current = null;
    setResizing(false);
    setLayout((prev) => {
      const next = { ...prev, width };
      writeStorage(next);
      return next;
    });
  }

  /** 切换收起态（收起 = 0px、整栏不渲染；宽度保留，展开恢复原宽）；立即持久化 */
  function toggleCollapse() {
    setLayout((prev) => {
      const next = { ...prev, collapsed: !prev.collapsed };
      writeStorage(next);
      return next;
    });
  }

  return { layout, resizing, railRef, startResize, moveResize, endResize, toggleCollapse };
}
