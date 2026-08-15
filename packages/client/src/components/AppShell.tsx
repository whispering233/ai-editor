// 应用外壳（doc/ui/layout.md §0/§2）：三栏装配——左栏 Sidebar + 中栏 MainPanel + 右栏 ChatPanel
// F7 修订（2026-08 用户反馈）：桌面态（≥1024px）三栏宽度可拖拽（像素）+ 左/右栏可收起/展开，
//   宽度与收起态 localStorage 持久化（hooks/use-panels，决策 10 同哲学——纯展示层不进数据文件）；
//   装配顺序 Sidebar（或收起窄条）→ 拖拽手柄 → MainPanel（flex-1 弹性吸收剩余空间）→ 拖拽手柄 →
//   ChatPanel（或收起窄条）；收起态下手柄隐藏/禁用（拖拽与收起互斥）。
//   <1024px 小屏不渲染手柄/收起条，三栏回退默认百分比类（右栏抽屉行为不变，开关在 InfoBar 右侧，
//   抽屉渲染在 ChatPanel；open 状态在此持有）
import { useState, type ReactNode } from "react";
import { GripVertical, PanelLeftOpen, PanelRightOpen } from "lucide-react";
import type { Route } from "../hooks/use-route";
import { usePanels } from "../hooks/use-panels";
import { cn } from "../lib/utils";
import { ChatPanel } from "./chat/ChatPanel";
import { FeedbackHost } from "./feedback/FeedbackHost";
import { MainPanel } from "./main-panel/MainPanel";
import { Sidebar } from "./sidebar/Sidebar";

/** 拖拽手柄（桌面态、对应栏展开时渲染）：6px 垂直细条，hover 高亮 + GripVertical 提示；
 *  pointer capture 实现拖拽——down 捕获指针后 move/up 持续由本手柄接收（移出窗口也不丢事件） */
function ResizeHandle({
  side,
  active,
  onStart,
  onMove,
  onEnd,
}: {
  side: "sidebar" | "chat";
  /** 当前拖拽是否发生在本手柄（决定拖拽态高亮） */
  active: boolean;
  onStart: (side: "sidebar" | "chat", clientX: number) => void;
  onMove: (side: "sidebar" | "chat", clientX: number) => void;
  onEnd: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "sidebar" ? "调整左栏宽度" : "调整右栏宽度"}
      title={side === "sidebar" ? "拖动调整左栏宽度" : "拖动调整右栏宽度"}
      onPointerDown={(e) => {
        // preventDefault 防文本选择起点；capture 保证拖出窗口后指针事件仍路由到手柄
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart(side, e.clientX);
      }}
      onPointerMove={(e) => onMove(side, e.clientX)}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      className={cn(
        "group relative z-10 h-full w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-border",
        active && "bg-border",
      )}
    >
      {/* 常显细线延续栏间分隔视觉；hover/拖拽中高亮为主色提示 */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/60 transition-colors group-hover:bg-primary/70" />
      <GripVertical className="absolute inset-y-0 left-1/2 size-4 -translate-x-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

/** 收起窄条（栏收起后替代主体渲染）：32px 窄条 + 展开按钮（点击恢复原宽） */
function CollapseStrip({ side, onExpand }: { side: "sidebar" | "chat"; onExpand: () => void }) {
  const isSidebar = side === "sidebar";
  const ExpandIcon = isSidebar ? PanelLeftOpen : PanelRightOpen;
  return (
    <div
      className={cn(
        "flex h-full w-8 shrink-0 flex-col items-center bg-sidebar",
        isSidebar ? "border-r border-border" : "border-l border-border",
      )}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={isSidebar ? "展开左栏" : "展开右栏"}
        title={isSidebar ? "展开左栏" : "展开右栏"}
        className="mt-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ExpandIcon className="size-4" />
      </button>
    </div>
  );
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  // 小屏抽屉开关状态（桌面态恒显示静态右栏，该状态不生效）
  const [chatOpen, setChatOpen] = useState(false);
  const { layout, isDesktop, dragSide, toggleCollapse, startResize, moveResize, endResize } = usePanels();
  const isDragging = dragSide !== null;

  return (
    // 拖拽期间根容器禁文本选中（指针已 capture 在手柄上，兜底防边缘选中）
    <div className={cn("flex h-screen overflow-hidden", isDragging && "select-none")}>
      {/* 左栏：收起 → 窄条；展开 → Sidebar（桌面传像素宽度覆盖默认 10%，小屏不传走默认百分比）；
          收起按钮（PanelLeftClose）渲染在产品标识行右侧（Sidebar 内部，仅桌面态传入回调时出现） */}
      {isDesktop && layout.collapsedSidebar ? (
        <CollapseStrip side="sidebar" onExpand={() => toggleCollapse("sidebar")} />
      ) : (
        <Sidebar
          width={isDesktop ? layout.sidebarWidth : undefined}
          onToggleCollapse={isDesktop ? () => toggleCollapse("sidebar") : undefined}
        />
      )}
      {/* 左|中拖拽手柄：仅桌面 + 左栏展开时渲染（收起态隐藏，拖拽与收起互斥） */}
      {isDesktop && !layout.collapsedSidebar && (
        <ResizeHandle side="sidebar" active={dragSide === "sidebar"} onStart={startResize} onMove={moveResize} onEnd={endResize} />
      )}
      {/* 中栏：桌面态 flex-1 弹性吸收左右栏固定宽之外的剩余空间（中栏不可收起，无收起入口） */}
      <MainPanel isDesktop={isDesktop} route={route} chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)}>
        {children}
      </MainPanel>
      {/* 中|右拖拽手柄：仅桌面 + 右栏展开时渲染 */}
      {isDesktop && !layout.collapsedChat && (
        <ResizeHandle side="chat" active={dragSide === "chat"} onStart={startResize} onMove={moveResize} onEnd={endResize} />
      )}
      {/* 右栏：收起 → 窄条；展开 → ChatPanel（桌面传像素宽度 + 收起按钮；小屏抽屉行为不变——
          open/onClose 仅小屏生效，收起按钮不渲染） */}
      {isDesktop && layout.collapsedChat ? (
        <CollapseStrip side="chat" onExpand={() => toggleCollapse("chat")} />
      ) : (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          width={isDesktop ? layout.chatWidth : undefined}
          onToggleCollapse={isDesktop ? () => toggleCollapse("chat") : undefined}
        />
      )}
      <FeedbackHost />
    </div>
  );
}
