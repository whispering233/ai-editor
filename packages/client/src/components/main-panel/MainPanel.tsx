// 中栏 MainPanel（doc/ui/layout.md §2）：信息条 + TabBar + 页面内容区（按路由渲染 children）
// loadConfig 挂载拉取逻辑自原 AppShell 迁移（信息条标题映射数据源，layout.md §3.1）；
// 失败静默——信息条显示「书架」，Dashboard 引导创建/打开项目
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import type { Route } from "../../hooks/use-route";
import { MIDDLE_MIN_WIDTH } from "../../hooks/use-panels";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";
import { InfoBar } from "./InfoBar";
import { TabBar } from "./TabBar";

export function MainPanel({
  route,
  chatOpen,
  onToggleChat,
  isDesktop,
  children,
}: {
  route: Route;
  chatOpen: boolean;
  onToggleChat: () => void;
  /** 桌面态标记（F7）：中栏 flex-1 弹性吸收左右栏固定宽之外的剩余空间；小屏回退默认 50% 百分比 */
  isDesktop: boolean;
  children: ReactNode;
}) {
  const loadConfig = useProjectStore((s) => s.loadConfig);
  // 决策 35：路由切换清空页面焦点（useLayoutEffect 父先于子——在子页面 mount 上报新焦点前
  // 清掉旧页残留，避免切页后「问 AI」注入过期上下文）
  const clearCurrentFocus = useUiStore((s) => s.clearCurrentFocus);

  // 挂载时拉取项目配置（失败静默，信息条显示「书架」不阻塞）
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useLayoutEffect(() => {
    clearCurrentFocus();
  }, [route.path, clearCurrentFocus]);

  return (
    <main
      className="flex min-w-0 flex-[5_1_50%] flex-col"
      style={isDesktop ? { flex: "1 1 0%", minWidth: MIDDLE_MIN_WIDTH } : undefined}
    >
      <InfoBar chatOpen={chatOpen} onToggleChat={onToggleChat} />
      <div className="shrink-0 px-3 py-2">
        <TabBar route={route} />
      </div>
      {/* 页面内容区：溢出纵向滚动（原 AppShell p-6 保留，页面不自带 padding） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
    </main>
  );
}
