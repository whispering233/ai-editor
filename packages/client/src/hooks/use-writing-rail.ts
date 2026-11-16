// 写作页卷章导航栏宽度与收起态 hook（DESIGN.md `writing-page`「宽度与收起」）：
// - 桌面态（≥1024px）宽度为像素（默认 240，拖拽区间 200–480），可收起为 0px；宽度保留、展开恢复原宽
// - 宽度与收起态持久化 localStorage（key ai-editor:writing-rail，全局一份、不随书；不进项目文件）
// - 拖拽期间（moveResize）只更新内存态，结束（endResize）时一次写入 localStorage
// - 纯函数（defaultWritingRailLayout / parseWritingRailLayout）从 hook 抽出供测试；hook 本体依赖 window，node 环境不渲染
import { useEffect, useRef, useState } from "react";
import { clampPanelWidth } from "./use-panels";

/** localStorage key（唯一 key，勿手抄字面量） */
export const WRITING_RAIL_STORAGE_KEY = "ai-editor:writing-rail";
/** 默认宽度（DESIGN 登记档） */
export const WRITING_RAIL_DEFAULT_WIDTH = 240;
/** 拖拽下限（章名与字数仍可读） */
export const WRITING_RAIL_MIN_WIDTH = 200;
/** 拖拽上限（再宽挤压正文列） */
export const WRITING_RAIL_MAX_WIDTH = 480;

export interface WritingRailLayout {
  width: number;
  collapsed: boolean;
}

/** 默认布局（无持久化 / 解析失败时） */
export function defaultWritingRailLayout(): WritingRailLayout {
  return { width: WRITING_RAIL_DEFAULT_WIDTH, collapsed: false };
}

/**
 * 解析持久化 JSON（localStorage 防御）：
 * - null / 空串 / 非法 JSON / 非对象 / 数组 / width 缺失或非有限数值 → 整体回退默认
 * - 宽度按 [min, max] 静态收敛（越界取整收敛）；收起态仅严格 true 生效（其他值按 false）
 */
export function parseWritingRailLayout(raw: string | null): WritingRailLayout {
  if (!raw) return defaultWritingRailLayout();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultWritingRailLayout();
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return defaultWritingRailLayout();
  const rec = data as Record<string, unknown>;
  const width = rec.width;
  if (typeof width !== "number" || !Number.isFinite(width)) return defaultWritingRailLayout();
  return {
    width: clampPanelWidth(width, WRITING_RAIL_MIN_WIDTH, WRITING_RAIL_MAX_WIDTH),
    collapsed: rec.collapsed === true,
  };
}

/** 安全读取 localStorage（隐私模式 / SSR 等异常 → null 回退默认） */
function readStorage(): string | null {
  if (typeof window === "undefined") return null; // SSR / node 环境防御（同 use-panels）
  try {
    return window.localStorage.getItem(WRITING_RAIL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 写入 localStorage（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStorage(layout: WritingRailLayout): void {
  try {
    window.localStorage.setItem(WRITING_RAIL_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // 忽略：纯展示层偏好，写失败不影响功能
  }
}

/**
 * 卷章导航栏状态 hook：宽度（像素）+ 收起态，localStorage 持久化。
 * 拖拽采用「起始快照 + 增量」模型：startResize 记录起点与起始宽，moveResize 每帧只更新内存态，
 * endResize 用 dragRef 的 lastX 算最终宽度并一次写入存储（不依赖可能尚未渲染的 state）。
 * desktop 仅用于跨断点兜底：拖拽中视口缩到 <1024px 时手柄卸载、pointerup 不再到达它。
 */
export function useWritingRail(desktop: boolean) {
  const [layout, setLayout] = useState<WritingRailLayout>(() =>
    parseWritingRailLayout(readStorage()),
  );
  const [resizing, setResizing] = useState(false);
  // 拖拽起点快照（pointerdown 记录；move/up 期间由手柄持续回调，移出窗口也不丢事件）
  const dragRef = useRef<{ startX: number; startWidth: number; lastX: number } | null>(null);

  // 跨断点清理（同 use-panels）：拖拽中视口缩到 <1024px ⇒ 手柄卸载、pointer capture 释放，
  // pointerup 不再到达手柄；兜底清拖拽态，避免根容器 select-none 永久生效。
  useEffect(() => {
    if (!desktop && dragRef.current !== null) {
      dragRef.current = null;
      setResizing(false);
    }
  }, [desktop]);

  /** 拖拽宽度计算：起点 + 增量（手柄 = 左栏右边界，右拖变宽），静态 [min, max] 收敛 */
  function dragWidth(drag: NonNullable<typeof dragRef.current>): number {
    return clampPanelWidth(
      drag.startWidth + (drag.lastX - drag.startX),
      WRITING_RAIL_MIN_WIDTH,
      WRITING_RAIL_MAX_WIDTH,
    );
  }

  /** 开始拖拽（手柄 pointerdown）：记录起点快照，标记拖拽中（页面据此禁文本选择） */
  function startResize(clientX: number) {
    dragRef.current = { startX: clientX, startWidth: layout.width, lastX: clientX };
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

  return { layout, resizing, startResize, moveResize, endResize, toggleCollapse };
}