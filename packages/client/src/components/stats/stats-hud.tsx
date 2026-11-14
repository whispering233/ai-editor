// 当日码字悬浮面板（`stats-hud`；DESIGN.md「当日码字悬浮面板」/ config.md `ai-editor:stats-panel`）。
//
// 宿主 = MainPanel 的 `<main>`：本组件是**绝对定位直接子元素**（`absolute inset-0`），不能放进
// `overflow-y-auto` 内容区（否则随正文滚动）。入口固定在中栏右下「问 AI」正上方（z 20 < AI 的 30）。
// 渲染条件 = 小说工作区 + 已打开项目 + 非专注模式；练习 / 书架 / 专注都不渲染，
// 但**追踪器与归零照常**（组件始终挂载 ⇒ syncProject effect 始终执行；专注期间数字继续累计）。
//
// 数字全部来自 `stores/writing-session` 内存态（不落库 / 不落 localStorage / 不发请求）；
// 只有面板**位置**持久化（lib/stats-hud）。计时：只在面板可见时秒级刷新。
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, FloatButton, Typography } from "antd";
import { BarChartOutlined, CloseOutlined } from "@ant-design/icons";
import { useProjectStore } from "../../stores/project";
import { useWritingSessionStore } from "../../stores/writing-session";
import {
  clampStatsPanelPosition,
  readStatsPanelPosition,
  resolveStatsPanelPosition,
  writeStatsPanelPosition,
  STATS_PANEL_ENTRY_BOTTOM,
  STATS_PANEL_ENTRY_INSET_END,
  type StatsPanelPosition,
} from "../../lib/stats-hud";
import { displayTypingMs, formatDuration, formatRate } from "../../lib/writing-session";
import { formatChars } from "../../lib/writing-stats";
import { cn } from "../../lib/utils";

/** 一项指标：标签 12px 次级色 + 值 20px 等宽数字 */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl tabular-nums">{value}</div>
    </div>
  );
}

export function StatsHud({ focusMode }: { focusMode: boolean }) {
  const config = useProjectStore((s) => s.config);
  const projectId = config?.id ?? null;
  const syncProject = useWritingSessionStore((s) => s.syncProject);
  const chars = useWritingSessionStore((s) => s.chars);
  const typingMs = useWritingSessionStore((s) => s.typingMs);
  const lastEditAt = useWritingSessionStore((s) => s.lastEditAt);
  const visible = useWritingSessionStore((s) => s.visible);
  const open = useWritingSessionStore((s) => s.open);
  const dismiss = useWritingSessionStore((s) => s.dismiss);

  const [now, setNow] = useState(() => Date.now());
  const [position, setPosition] = useState<StatsPanelPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // 换书 / 关闭项目立即归零（不等下一次增量）：用 layout effect——绘制前完成归零，
  // 不会有一帧旧书数字
  useLayoutEffect(() => {
    syncProject(projectId);
  }, [projectId, syncProject]);

  // 空闲时间秒级刷新：只在面板可见时跑 interval（隐藏 / 卸载即清理）
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  // 首次显示 / 中栏尺寸变化：把位置收敛进宿主矩形（保存位置 → 否则默认槽位）
  useLayoutEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    const panel = panelRef.current;
    if (host === null || panel === null) return;
    const measure = (): void => {
      const bounds = host.getBoundingClientRect();
      const size = { width: panel.offsetWidth, height: panel.offsetHeight };
      setPosition((current) =>
        clampStatsPanelPosition(
          current ?? resolveStatsPanelPosition(readStatsPanelPosition(), bounds, size),
          bounds,
          size,
        ),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return; // 无 ResizeObserver 的环境安全跳过
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible, focusMode]);

  // 拖动期间禁止选中文本（松手即恢复）
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("select-none");
    return () => document.body.classList.remove("select-none");
  }, [dragging]);

  /** 指针位置 → 面板位置（按宿主矩形与面板尺寸 clamp） */
  function dragPosition(clientX: number, clientY: number): StatsPanelPosition | null {
    const host = hostRef.current;
    const panel = panelRef.current;
    if (host === null || panel === null) return null;
    const bounds = host.getBoundingClientRect();
    return clampStatsPanelPosition(
      {
        left: clientX - bounds.left - dragOffsetRef.current.x,
        top: clientY - bounds.top - dragOffsetRef.current.y,
      },
      bounds,
      { width: panel.offsetWidth, height: panel.offsetHeight },
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const panel = panelRef.current;
    if (panel === null) return;
    const panelRect = panel.getBoundingClientRect();
    dragOffsetRef.current = { x: event.clientX - panelRect.left, y: event.clientY - panelRect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    const next = dragPosition(event.clientX, event.clientY);
    if (next !== null) setPosition(next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const next = dragPosition(event.clientX, event.clientY);
    if (next !== null) {
      setPosition(next);
      writeStatsPanelPosition(next); // 只存位置，不存数字
    }
  }

  // 练习工作区 / 无项目 / 专注模式：不渲染（syncProject 仍在上面的 effect 里执行）
  if (config === null || config.kind === "practice" || focusMode) return null;

  const numbers = { chars, typingMs, lastEditAt };
  const typing = displayTypingMs(numbers, now);
  const idle = lastEditAt === null ? 0 : now - lastEditAt;

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20">
      {!visible && (
        <FloatButton
          icon={<BarChartOutlined className="text-base" />}
          aria-label="码字统计"
          tooltip={{ title: "码字统计", placement: "left" }}
          onClick={open}
          className="pointer-events-auto"
          style={{
            position: "absolute",
            insetInlineEnd: STATS_PANEL_ENTRY_INSET_END,
            bottom: STATS_PANEL_ENTRY_BOTTOM,
            zIndex: 20,
          }}
        />
      )}
      {visible && (
        <div
          ref={panelRef}
          role="region"
          aria-label="码字统计"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={cn(
            "pointer-events-auto absolute w-60 touch-none rounded-lg bg-popover p-3 shadow-md ring-1 ring-foreground/10",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          style={
            position === null
              ? { insetInlineEnd: STATS_PANEL_ENTRY_INSET_END, bottom: STATS_PANEL_ENTRY_BOTTOM }
              : { left: position.left, top: position.top }
          }
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Typography.Title level={5}>码字统计 · 本次</Typography.Title>
              <div className="text-xs text-muted-foreground">拖动标题栏移动</div>
            </div>
            <Button
              size="small"
              color="default"
              variant="text"
              icon={<CloseOutlined />}
              aria-label="关闭码字统计"
              className="shrink-0"
              onPointerDown={(event) => event.stopPropagation()} // 点 X 不触发拖动
              onClick={dismiss}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="本次码字" value={formatChars(chars)} />
            <Metric label="码字速率（字/时）" value={formatRate(chars, typing)} />
            <Metric label="码字时间" value={formatDuration(typing)} />
            <Metric label="空闲时间" value={formatDuration(idle)} />
          </div>
        </div>
      )}
    </div>
  );
}