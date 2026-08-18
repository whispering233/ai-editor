// 三栏工作台宽度与收起态 hook（doc/ui/layout.md §0 F7、决策 22 修订注记）：
// - 桌面态（≥1024px）左/右栏宽度为**像素**（可拖拽，覆盖默认 10%/40% 百分比）；中栏不可收起，
//   保底最小宽度 MIDDLE_MIN_WIDTH（由 MainPanel minWidth 保证，flex 自然吸收窗口收缩）
// - 左/右栏可收起（收起后由 AppShell 渲染 32px 窄条 + 展开按钮），收起态下拖拽手柄隐藏（互斥）
// - 宽度与收起态持久化 localStorage（key ai-editor:panels，决策 10 同哲学：纯展示层不进数据文件）；
//   持久化 JSON 为扁平 { sidebarWidth, chatWidth, collapsedSidebar, collapsedChat }
//   （F7 规格建议的嵌套 collapsed 形状在实现时扁平化，与 parsePanelLayout 契约一致）
// - 拖拽期间（moveResize）只更新内存态，结束（endResize）时一次写入 localStorage——
//   避免拖拽过程高频写存储
// - 纯函数（clampPanelLayout 系列）从 hook 抽出供测试；hook 本体依赖 window，node 环境不渲染
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./use-media-query";

/** 左栏宽度下限（Sidebar 内容紧凑布局 + truncate，160px 可用；仅约束拖拽与持久化值） */
export const SIDEBAR_MIN_WIDTH = 160;
/** 左栏宽度上限（与右栏 720 构成 2:3 对称设计区间 160:240 = 480:720，layout.md §0 契约） */
export const SIDEBAR_MAX_WIDTH = 480;
/** 右栏宽度下限（消息气泡 + 输入区可用） */
export const CHAT_MIN_WIDTH = 240;
/** 右栏宽度上限 */
export const CHAT_MAX_WIDTH = 720;
/** 中栏保底宽度（内容页信息密度高，不可完全收起） */
export const MIDDLE_MIN_WIDTH = 320;
/** localStorage key */
export const PANELS_STORAGE_KEY = "ai-editor:panels";
/** 桌面断点（与 useMediaQuery 的 <1024px 抽屉断点一致）：更窄视口的默认宽度不参与布局 */
const DESKTOP_BREAKPOINT = 1024;
/** 兜底视口（SSR / window 异常时用，与常见桌面宽度一致） */
const FALLBACK_VIEWPORT = 1440;

export interface PanelLayout {
  sidebarWidth: number;
  chatWidth: number;
  collapsedSidebar: boolean;
  collapsedChat: boolean;
}

/** 拖拽目标侧：sidebar = 左|中 手柄（改左栏宽）；chat = 中|右 手柄（改右栏宽） */
type SideKey = "sidebar" | "chat";

/** clamp 到 [min, max] 并取整（拖拽产生的小数宽度收敛为整数，防 subpixel 渲染抖动） */
export function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(width, min), max));
}

/**
 * 默认布局（无持久化 / 解析失败时）：按视口换算旧版 1:5:4 的 10%/40% 像素——
 * 首载视觉与旧版比例一致（固定像素如 240/400 会在不同视口改变比例，故不用）；
 * 换算值收敛到 [min, max] 可读区间（存储值即渲染值——渲染层 minWidth 会兜底，
 * 直接 clamp 使两者一致，避免存储 144 渲染 160 的注释/行为偏差）；
 * 窄视口（< 桌面断点）宽度不参与布局（三栏回退百分比、右栏抽屉），直接给最小可读宽度，
 * 避免持久化无意义的小值
 */
export function defaultPanelLayout(viewport: number): PanelLayout {
  const vp = Number.isFinite(viewport) && viewport > 0 ? viewport : FALLBACK_VIEWPORT;
  return {
    sidebarWidth:
      vp < DESKTOP_BREAKPOINT
        ? SIDEBAR_MIN_WIDTH
        : clampPanelWidth(vp * 0.1, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
    chatWidth:
      vp < DESKTOP_BREAKPOINT
        ? CHAT_MIN_WIDTH
        : clampPanelWidth(vp * 0.4, CHAT_MIN_WIDTH, CHAT_MAX_WIDTH),
    collapsedSidebar: false,
    collapsedChat: false,
  };
}

/**
 * 解析持久化 JSON（localStorage 防御）：
 * - null / 非法 JSON / 非对象 / 缺任一宽度字段 / 字段类型错 → 整体回退默认
 * - 宽度按 [min, max] 静态收敛（越界取整收敛）；视口溢出（保存的大宽度遇小视口）由
 *   flex shrink + minWidth 自然处理，无需在此动态收敛
 * - 收起态仅严格 true 生效（其他值按 false）
 */
export function parsePanelLayout(raw: string | null, viewport: number): PanelLayout {
  if (!raw) return defaultPanelLayout(viewport);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultPanelLayout(viewport);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return defaultPanelLayout(viewport);
  const rec = data as Record<string, unknown>;
  const sidebarWidth = rec.sidebarWidth;
  const chatWidth = rec.chatWidth;
  // 任一宽度字段缺失/非有限数值 → 整体回退默认（形状不符视为脏数据，不做部分恢复）
  if (
    typeof sidebarWidth !== "number" ||
    !Number.isFinite(sidebarWidth) ||
    typeof chatWidth !== "number" ||
    !Number.isFinite(chatWidth)
  ) {
    return defaultPanelLayout(viewport);
  }
  return {
    sidebarWidth: clampPanelWidth(sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
    chatWidth: clampPanelWidth(chatWidth, CHAT_MIN_WIDTH, CHAT_MAX_WIDTH),
    collapsedSidebar: rec.collapsedSidebar === true,
    collapsedChat: rec.collapsedChat === true,
  };
}

/** 序列化持久化 JSON（扁平形状，见文件头契约说明） */
function serializeLayout(layout: PanelLayout): string {
  return JSON.stringify({
    sidebarWidth: layout.sidebarWidth,
    chatWidth: layout.chatWidth,
    collapsedSidebar: layout.collapsedSidebar,
    collapsedChat: layout.collapsedChat,
  });
}

/** 安全读取 localStorage（隐私模式 / SSR 等异常 → null 回退默认） */
function readStorage(): string | null {
  if (typeof window === "undefined") return null; // SSR / node 环境防御（同 getViewport）
  try {
    return window.localStorage.getItem(PANELS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 写入 localStorage（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStorage(json: string): void {
  try {
    window.localStorage.setItem(PANELS_STORAGE_KEY, json);
  } catch {
    // 忽略：纯展示层偏好，写失败不影响功能
  }
}

/** 安全读取视口宽度（SSR / 测试 window stub 无 innerWidth 时回退默认，防 NaN 污染状态） */
function getViewport(): number {
  if (typeof window === "undefined") return FALLBACK_VIEWPORT;
  const vp = window.innerWidth;
  return Number.isFinite(vp) && vp > 0 ? vp : FALLBACK_VIEWPORT;
}

/**
 * 三栏面板状态 hook（F7）：宽度（像素）+ 收起态，localStorage 持久化。
 * 拖拽采用「起始快照 + 增量」模型：startResize 记录起点，moveResize 每帧只更新内存态，
 * endResize 用函数式更新保证取到最新宽度后一次写入存储
 */
export function usePanels() {
  const [layout, setLayout] = useState<PanelLayout>(() =>
    parsePanelLayout(readStorage(), getViewport()),
  );
  const [dragSide, setDragSide] = useState<SideKey | null>(null);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  // 拖拽起点快照（pointerdown 记录；move/up 期间由手柄持续回调，移出窗口也不丢事件）
  const dragRef = useRef<{
    side: SideKey;
    startX: number;
    startWidth: number;
    lastX: number;
  } | null>(null);

  // 跨断点清理（P2-2）：拖拽中视口缩至 <1024px 时手柄卸载（pointer capture 随之释放），
  // pointerup 不再路由到手柄 → endResize 永不触发；此处兜底清拖拽态，
  // 防 dragSide 残留（select-none 永久生效 + 手柄 active 高亮）
  useEffect(() => {
    if (!isDesktop && dragRef.current !== null) {
      dragRef.current = null;
      setDragSide(null);
    }
  }, [isDesktop]);

  /** 拖拽宽度计算：起点 + 增量，静态 [min, max] 收敛（视口收缩由 flex shrink + minWidth 兜底） */
  function dragWidth(drag: NonNullable<typeof dragRef.current>): number {
    const delta = drag.lastX - drag.startX;
    const [min, max] =
      drag.side === "sidebar"
        ? [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]
        : [CHAT_MIN_WIDTH, CHAT_MAX_WIDTH];
    // 左柄（sidebar）= 左栏右边界：右拖变宽（+delta）；右柄（chat）= 右栏左边界：左拖变宽（-delta）。
    // 两者语义一致——手柄即栏边界，拖到哪边界到哪（边界跟随指针）
    const width = drag.side === "sidebar" ? drag.startWidth + delta : drag.startWidth - delta;
    return clampPanelWidth(width, min, max);
  }

  /** 开始拖拽（手柄 pointerdown）：记录起点快照，标记拖拽侧（AppShell 据此禁文本选择） */
  function startResize(side: SideKey, clientX: number) {
    const startWidth = side === "sidebar" ? layout.sidebarWidth : layout.chatWidth;
    dragRef.current = { side, startX: clientX, startWidth, lastX: clientX };
    setDragSide(side);
  }

  /** 拖拽中（手柄 pointermove）：增量更新内存态，不写 localStorage */
  function moveResize(side: SideKey, clientX: number) {
    const drag = dragRef.current;
    if (!drag || drag.side !== side) return;
    drag.lastX = clientX;
    const next = dragWidth(drag);
    setLayout((prev) => ({
      ...prev,
      ...(side === "sidebar" ? { sidebarWidth: next } : { chatWidth: next }),
    }));
  }

  /** 拖拽结束（手柄 pointerup / pointercancel）：取最新宽度一次写入存储，清拖拽态 */
  function endResize() {
    const drag = dragRef.current;
    if (!drag) return;
    const next = dragWidth(drag);
    dragRef.current = null;
    setDragSide(null);
    setLayout((prev) => {
      const nextLayout = {
        ...prev,
        ...(drag.side === "sidebar" ? { sidebarWidth: next } : { chatWidth: next }),
      };
      writeStorage(serializeLayout(nextLayout));
      return nextLayout;
    });
  }

  /** 切换收起态（收起为窄条 + 展开按钮；宽度保留，展开恢复原宽）；立即持久化 */
  function toggleCollapse(side: SideKey) {
    setLayout((prev) => {
      const next =
        side === "sidebar"
          ? { ...prev, collapsedSidebar: !prev.collapsedSidebar }
          : { ...prev, collapsedChat: !prev.collapsedChat };
      writeStorage(serializeLayout(next));
      return next;
    });
  }

  return { layout, isDesktop, dragSide, toggleCollapse, startResize, moveResize, endResize };
}
