// 应用外壳（§2）：三栏装配——左栏 Sidebar + 中栏 MainPanel + 右栏 ChatPanel
// F7 修订（2026-08 用户反馈）：桌面态（≥1024px）三栏宽度可拖拽（像素）+ 左/右栏可收起/展开，
// 宽度与收起态 localStorage 持久化（hooks/use-panels，同哲学——纯展示层不进数据文件）；
// 装配顺序 Sidebar（或收起窄条）→ 拖拽手柄 → MainPanel（flex-1 弹性吸收剩余空间）→ 拖拽手柄 →
// ChatPanel（或收起窄条）；收起态下手柄隐藏/禁用（拖拽与收起互斥）。
// <1024px 小屏不渲染手柄/收起条，三栏回退默认百分比类（右栏抽屉行为不变，开关在 InfoBar 右侧，
// 抽屉渲染在 ChatPanel；open 状态在此持有）
import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "../hooks/use-route";
import { usePanels } from "../hooks/use-panels";
import { useCloudStore } from "../stores/cloud";
import { useProjectStore } from "../stores/project";
import { useSaveArchive } from "../hooks/use-save-archive";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { ChatPanel } from "./chat/ChatPanel";
import { FeedbackHost } from "./feedback/FeedbackHost";
import { CloudConflictDialog } from "./settings/cloud-conflict-dialog";
import { CloudPullConfirm } from "./settings/cloud-pull-confirm";
import { CloudStaleBackupDialog } from "./settings/cloud-stale-backup-dialog";
import { MainPanel } from "./main-panel/MainPanel";
import { NavRail } from "./nav/NavRail";
import { CollapseStrip } from "./ui/collapse-strip";
import { ResizeHandle } from "./ui/resize-handle";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  // 小屏抽屉开关状态（桌面态恒显示静态右栏，该状态不生效）
  const [chatOpen, setChatOpen] = useState(false);
  const { layout, isDesktop, dragSide, toggleCollapse, startResize, moveResize, endResize } =
    usePanels();
  const isDragging = dragSide !== null;
  // 专注模式（卡 13.4，仅章正文页）：为真时只渲染中栏（左栏 / 右栏 / 两根拖拽手柄 / 收起条全不渲染）
  const focusMode = useUiStore((s) => s.focusMode);

  // 全站 Ctrl/Cmd + S 的存档阶段（契约 DESIGN.md §设置页「快捷键」区）：
  // 挂在外壳层 = 任意页面（含专注模式、左栏收起）按快捷键都能生成存档；无项目时只保存不存档
  useSaveArchive();

  // 云端状态的「打开项目时那次检查」挂在外壳层（卡 C）：左栏收起时 NavRail 不挂载，
  // 不能只挂在那里——自动推送会改服务端同步状态，收起左栏同样需要复查与清理。
  // 不做轮询：/status 每次 2-3 次 PROPFIND，云盘免费额度 600 次/30 分钟；并发由 store 合并。
  const projectId = useProjectStore((s) => s.config?.id ?? null);
  const refreshCloud = useCloudStore((s) => s.refresh);
  const clearCloudStatus = useCloudStore((s) => s.clearStatus);
  useEffect(() => {
    if (projectId === null) {
      clearCloudStatus();
      return;
    }
    void refreshCloud();
  }, [projectId, refreshCloud, clearCloudStatus]);

  return (
    // 拖拽期间根容器禁文本选中（指针已 capture 在手柄上，兜底防边缘选中）
    <div className={cn("flex h-screen overflow-hidden", isDragging && "select-none")}>
      {/* 专注模式（卡 13.4，契约 DESIGN.md §Layout「专注模式」）：只渲染中栏——左栏 / 右栏 /
          两根拖拽手柄 / 收起条一律不渲染（退出来自工具条按钮或 Esc，整棵外壳即刻回来） */}
      {!focusMode && (
        <>
          {/* 左栏：收起 → 窄条；展开 → Sidebar（桌面传像素宽度覆盖默认 10%，小屏不传走默认百分比）；
              收起按钮（PanelLeftClose）渲染在产品标识行右侧（Sidebar 内部，仅桌面态传入回调时出现） */}
          {isDesktop && layout.collapsedSidebar ? (
            <CollapseStrip side="left" label="展开左栏" onExpand={() => toggleCollapse("sidebar")} />
          ) : (
            <NavRail
              width={isDesktop ? layout.sidebarWidth : undefined}
              onToggleCollapse={isDesktop ? () => toggleCollapse("sidebar") : undefined}
            />
          )}
          {/* 左|中拖拽手柄：仅桌面 + 左栏展开时渲染（收起态隐藏，拖拽与收起互斥） */}
          {isDesktop && !layout.collapsedSidebar && (
            <ResizeHandle
              label="调整左栏宽度"
              active={dragSide === "sidebar"}
              onStart={(clientX) => startResize("sidebar", clientX)}
              onMove={(clientX) => moveResize("sidebar", clientX)}
              onEnd={endResize}
            />
          )}
        </>
      )}
      {/* 中栏：桌面态 flex-1 弹性吸收左右栏固定宽之外的剩余空间（中栏不可收起，无收起入口） */}
      <MainPanel
        isDesktop={isDesktop}
        route={route}
        focusMode={focusMode}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
        onOpenChat={() => {
          // 悬浮问 AI「点击必有反应」：小屏开抽屉；桌面右栏收起时展开（已展开则不动作 → false）
          if (!isDesktop) {
            if (chatOpen) return false;
            setChatOpen(true);
            return true;
          }
          if (layout.collapsedChat) {
            toggleCollapse("chat");
            return true;
          }
          return false;
        }}
      >
        {children}
      </MainPanel>
      {!focusMode && (
        <>
          {/* 中|右拖拽手柄：仅桌面 + 右栏展开时渲染 */}
          {isDesktop && !layout.collapsedChat && (
            <ResizeHandle
              label="调整右栏宽度"
              active={dragSide === "chat"}
              onStart={(clientX) => startResize("chat", clientX)}
              onMove={(clientX) => moveResize("chat", clientX)}
              onEnd={endResize}
            />
          )}
          {/* 右栏：收起 → 窄条；展开 → ChatPanel（桌面传像素宽度 + 收起按钮；小屏抽屉行为不变——
              open/onClose 仅小屏生效，收起按钮不渲染） */}
          {isDesktop && layout.collapsedChat ? (
            <CollapseStrip side="right" label="展开右栏" onExpand={() => toggleCollapse("chat")} />
          ) : (
            <ChatPanel
              open={chatOpen}
              onClose={() => setChatOpen(false)}
              width={isDesktop ? layout.chatWidth : undefined}
              onToggleCollapse={isDesktop ? () => toggleCollapse("chat") : undefined}
            />
          )}
        </>
      )}
      {/* 云端两个对话框的单点宿主（卡 6）：左栏「同步云端」与设置页云端面板共用同一份状态；
          挂在外壳层——左栏收起（NavRail 不渲染）时也能弹 */}
      <CloudPullConfirm />
      <CloudConflictDialog />
      <CloudStaleBackupDialog />
      <FeedbackHost />
    </div>
  );
}
