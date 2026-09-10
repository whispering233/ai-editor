// 中栏 MainPanel：信息条 + 页面内容区（按路由渲染 children；批次十七 1-2 起无 TabBar——
// 导航并入左栏 NavRail）
// loadConfig 挂载拉取逻辑自原 AppShell 迁移（信息条标题映射数据源，）；
// 失败静默——信息条显示「书架」，书架主页引导创建/打开项目
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { FloatButton } from "antd";
import { Sparkles } from "lucide-react";
import type { Route } from "../../hooks/use-route";
import { MIDDLE_MIN_WIDTH } from "../../hooks/use-panels";
import { useProjectStore } from "../../stores/project";
import { useChatStore } from "../../stores/chat";
import { useUiStore } from "../../stores/ui";
import { InfoBar } from "./InfoBar";

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
  const config = useProjectStore((s) => s.config);
 /** 当前页面焦点（C1 悬浮问 AI：注入右栏 = focus 小条；null = 普通进入聊天） */
  const currentFocus = useUiStore((s) => s.currentFocus);
  const setFocusContext = useChatStore((s) => s.setFocusContext);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
 // 路由切换清空页面焦点（useLayoutEffect 父先于子——在子页面 mount 上报新焦点前
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
      className="relative flex min-w-0 flex-[5_1_50%] flex-col"
      style={isDesktop ? { flex: "1 1 0%", minWidth: MIDDLE_MIN_WIDTH } : undefined}
    >
      <InfoBar chatOpen={chatOpen} onToggleChat={onToggleChat} />
      {/* 页面内容区：溢出纵向滚动（原 AppShell p-6 保留，页面不自带 padding） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      {/* 中栏右下悬浮「问 AI」（批次十八 C1，用户反馈 #3）：绝对定位于中栏容器（不越到右栏，
          滚动区外不随内容滚动）；点「无焦点」= 普通进入聊天，按钮必有反应（聚焦右栏输入框）；
          无项目打开时禁用（同原信息条语义） */}
      <FloatButton
        icon={<Sparkles className="size-5" />}
        type="primary"
        disabled={!config}
        aria-label="问 AI"
        tooltip={{ title: currentFocus ? "带着当前页面上下文去问 AI" : "去问 AI", placement: "left" }}
        onClick={() => {
          setFocusContext(currentFocus);
          requestFocusInput();
        }}
        style={{ position: "absolute", insetInlineEnd: 16, bottom: 16, zIndex: 30 }}
      />
    </main>
  );
}
