// 应用外壳（§2）：三栏装配——左栏 Sidebar + 中栏 MainPanel + 右栏 ChatPanel
// F7 修订（2026-08 用户反馈）：桌面态（≥1024px）三栏宽度可拖拽（像素）+ 左/右栏可收起/展开，
// 宽度与收起态 localStorage 持久化（hooks/use-panels，同哲学——纯展示层不进数据文件）；
// 2026-11 修订：**收起 = 0px**（不渲染该栏、无窄条、无占位）；整栏的收起/展开入口不在任何栏里——
// 两枚 `PanelToggleButton` 由 `ShellPanelToggles` 常驻渲染于视口顶带两角（绝对定位于本根容器，
// 坐标只由视口决定 ⇒ 拖拽栏宽、收起 / 展开都不位移、不卸载，见 DESIGN.md §Layout「三栏」）。
// 各栏顶行按可见性让出 48px 槽位（`reserveShellToggle`），内容起点不随收起态跳动。
// 装配顺序 Sidebar（展开态）→ 拖拽手柄 → MainPanel（flex-1 弹性吸收剩余空间）→ 拖拽手柄 →
// ChatPanel（展开态）；拖拽手柄仅在「桌面 + 该栏展开」时渲染（拖拽与收起互斥）。
// <1024px 小屏不渲染手柄、也不渲染顶带开关（右栏是抽屉），三栏回退默认百分比类
// （右栏抽屉行为不变，开关在 MainToolbar 右侧，抽屉渲染在 ChatPanel；open 状态在此持有）
import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "../hooks/use-route";
import { usePanels } from "../hooks/use-panels";
import { useCloudStore } from "../stores/cloud";
import { useProjectStore } from "../stores/project";
import { useSaveArchive } from "../hooks/use-save-archive";
import { useZoomNotice } from "../hooks/use-zoom-notice";
import { useUiStore } from "../stores/ui";
import { cn } from "../lib/utils";
import { desktopBridge } from "../lib/desktop";
import { flushSucceeded } from "../lib/desktop-flush";
import { panelShortcutFor } from "../lib/panel-shortcuts";
import { triggerSaveShortcut } from "../lib/save-shortcut";
import { ChatPanel } from "./chat/ChatPanel";
import { FeedbackHost } from "./feedback/FeedbackHost";
import { CloudConflictDialog } from "./settings/cloud-conflict-dialog";
import { CloudPullConfirm } from "./settings/cloud-pull-confirm";
import { CloudStaleBackupDialog } from "./settings/cloud-stale-backup-dialog";
import { MainPanel } from "./main-panel/MainPanel";
import { ShellPanelToggles } from "./main-panel/shell-panel-toggles";
import { NavRail } from "./nav/NavRail";
import { ResizeHandle } from "./ui/resize-handle";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  // 小屏抽屉开关状态（桌面态恒显示静态右栏，该状态不生效）
  const [chatOpen, setChatOpen] = useState(false);
  const { layout, isDesktop, dragSide, toggleCollapse, startResize, moveResize, endResize } =
    usePanels();
  const isDragging = dragSide !== null;
  // 专注模式（卡 13.4，仅章正文页）：为真时只渲染中栏（左栏 / 右栏 / 两根拖拽手柄全不渲染）
  const focusMode = useUiStore((s) => s.focusMode);
  // 右栏临时收起（C2 章历史抽屉打开期间）：瞬态，不改 `layout.collapsedChat` 偏好
  const chatSuppressed = useUiStore((s) => s.chatPanelSuppressed);
  const chatVisible = !layout.collapsedChat && !chatSuppressed;

  // 全站 Ctrl/Cmd + S 的存档阶段（契约 DESIGN.md §设置页「快捷键」区）：
  // 挂在外壳层 = 任意页面（含专注模式、左栏收起）按快捷键都能生成存档；无项目时只保存不存档
  useSaveArchive();

  // 桌面关窗前落盘（卡 C1，`50-desktop.md` §1.1）：主进程拦 close → 跑一次栈顶保存动作 → 回执 ok。
  // 挂外壳层 = 任意页面（含左栏/右栏收起、专注模式）关窗都能落盘；浏览器形态没有这条通道
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    return bridge.onFlushRequest(() => flushSucceeded(triggerSaveShortcut()));
  }, []);

  // 界面缩放的变化提示（`50-desktop.md` §4.1「可见性」）：三个入口都经主进程推送落到这里
  useZoomNotice();

  // 整栏快捷键（卡 L2，DESIGN.md §Layout「三栏」）：仅桌面 + 非专注模式注册；
  // 可编辑区不抢键（块编辑器 Mod+B 保持加粗），口径与判定同在 lib/panel-shortcuts
  useEffect(() => {
    if (!isDesktop || focusMode) return;
    function onKeyDown(e: KeyboardEvent) {
      // 逐字段取值：DOM 事件字段在原型上，展开（`{...e}`）会丢
      const panel = panelShortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        target: e.target instanceof Element ? e.target : null,
      });
      if (panel === null || e.repeat) return;
      e.preventDefault();
      toggleCollapse(panel);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktop, focusMode, toggleCollapse]);

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
    <div className={cn("relative flex h-screen overflow-hidden", isDragging && "select-none")}>
      {/* 专注模式（卡 13.4，契约 DESIGN.md §Layout「专注模式」）：只渲染中栏——左栏 / 右栏 /
          两根拖拽手柄一律不渲染（退出来自工具条按钮或 Esc，整棵外壳即刻回来） */}
      {!focusMode && (
        <>
          {/* 左栏：桌面收起态 = 0px（整栏不渲染，无窄条/占位）；展开态 = NavRail + 拖拽手柄。
              整栏开关锚定视口顶带（`ShellPanelToggles`），栏顶行让出 48px 槽位。 */}
          {(!isDesktop || !layout.collapsedSidebar) && (
            <>
              <NavRail
                width={isDesktop ? layout.sidebarWidth : undefined}
                reserveShellToggle={isDesktop}
              />
              {/* 左|中拖拽手柄：仅桌面 + 左栏展开时渲染（收起态无处可拖） */}
              {isDesktop && (
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
        </>
      )}
      {/* 中栏：桌面态 flex-1 弹性吸收左右栏固定宽之外的剩余空间（中栏不可收起，无收起入口） */}
      <MainPanel
        isDesktop={isDesktop}
        route={route}
        focusMode={focusMode}
        chatOpen={chatOpen}
        sidebarCollapsed={layout.collapsedSidebar}
        chatCollapsed={layout.collapsedChat}
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
          {isDesktop && chatVisible && (
            <ResizeHandle
              label="调整右栏宽度"
              active={dragSide === "chat"}
              onStart={(clientX) => startResize("chat", clientX)}
              onMove={(clientX) => moveResize("chat", clientX)}
              onEnd={endResize}
            />
          )}
          {/* 右栏：桌面收起态 = 0px（整栏不渲染，无窄条/占位）；展开态 = ChatPanel（桌面传像素宽度）；
              小屏抽屉行为不变——open/onClose 仅小屏生效 */}
          {(!isDesktop || chatVisible) && (
            <ChatPanel
              open={chatOpen}
              onClose={() => setChatOpen(false)}
              width={isDesktop ? layout.chatWidth : undefined}
              reserveShellToggle={isDesktop}
            />
          )}
        </>
      )}
      {/* 整栏开关：绝对定位于本根容器顶带两角（y 恒 12px），不随栏宽 / 收起态位移、永不卸载——
          放在三栏之后才能画在 `relative` 的中栏之上。窄屏（右栏是抽屉）与专注模式不渲染 */}
      {!focusMode && isDesktop && (
        <ShellPanelToggles
          sidebarCollapsed={layout.collapsedSidebar}
          chatCollapsed={layout.collapsedChat}
          onToggleSidebar={() => toggleCollapse("sidebar")}
          onToggleChat={() => toggleCollapse("chat")}
        />
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
