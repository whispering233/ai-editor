// 中栏 MainPanel：信息条 + 页面内容区（按路由渲染 children；起无 TabBar——
// 导航并入左栏 NavRail）
// loadConfig 挂载拉取逻辑自原 AppShell 迁移（信息条标题映射数据源）；
// 失败静默——信息条显示「书架」，书架主页引导创建/打开项目
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { FloatButton } from "antd";
import { CommentOutlined } from "@ant-design/icons";
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
  onOpenChat,
  isDesktop,
  focusMode = false,
  children,
}: {
  route: Route;
  chatOpen: boolean;
  onToggleChat: () => void;
  /** 打开/展开右栏聊天（悬浮问 AI 的「点击必有反应」兜底：桌面收起态展开、小屏抽屉打开）；
   * 返回是否真的发生了打开/展开（false = 右栏本就可见，本次点击无可见变化） */
  onOpenChat: () => boolean;
  /** 桌面态标记（F7）：中栏 flex-1 弹性吸收左右栏固定宽之外的剩余空间；小屏回退默认 50% 百分比 */
  isDesktop: boolean;
  /** 专注模式（卡 13.4，仅章正文页）：不渲染 `InfoBar`；内容区、滚动容器与悬浮球一律不变 */
  focusMode?: boolean;
  children: ReactNode;
}) {
  const loadConfig = useProjectStore((s) => s.loadConfig);
  const config = useProjectStore((s) => s.config);
  /** 当前页面焦点（C1 悬浮问 AI：注入右栏 = focus 小条；null = 普通进入聊天） */
  const currentFocus = useUiStore((s) => s.currentFocus);
  const setFocusContext = useChatStore((s) => s.setFocusContext);
  const requestFocusInput = useChatStore((s) => s.requestFocusInput);
  // 路由切换清空页面焦点（useLayoutEffect 父先于子——在子页面 mount 上报新焦点前
  // 清掉旧页残留，避免切页后「问 AI」注入过期上下文）；卡 13.4：同一处把专注模式归零——
  // 浏览器后退/前进（或切章）离开正文页时布局必须立刻恢复，专注态绝不跨页残留
  const clearCurrentFocus = useUiStore((s) => s.clearCurrentFocus);
  const setFocusMode = useUiStore((s) => s.setFocusMode);

  // 挂载时拉取项目配置（失败静默，信息条显示「书架」不阻塞）
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useLayoutEffect(() => {
    clearCurrentFocus();
    setFocusMode(false);
  }, [route.path, clearCurrentFocus, setFocusMode]);

  return (
    <main
      className="relative flex min-w-0 flex-[5_1_50%] flex-col"
      style={isDesktop ? { flex: "1 1 0%", minWidth: MIDDLE_MIN_WIDTH } : undefined}
    >
      {/* 信息条在专注模式下隐藏（契约 DESIGN.md §Layout「专注模式」）；内容区与悬浮球不受影响 */}
      {!focusMode && <InfoBar chatOpen={chatOpen} onToggleChat={onToggleChat} />}
      {/* 页面内容区：溢出纵向滚动（原 AppShell p-6 保留，页面不自带 padding） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      {/* 中栏右下悬浮「问 AI」（C1，用户反馈 #3）：绝对定位于中栏容器（不越到右栏，
          滚动区外不随内容滚动）；点「无焦点」= 普通进入聊天，聚焦右栏输入框。
          「点击必有反应」（用户反馈跟进）：右栏收起/小屏抽屉关着时先展开打开（onOpenChat），
          无项目打开时不置 disabled（会吞掉点击与 tooltip）而是轻提示引导 */}
      <FloatButton
        icon={<CommentOutlined className="text-xl" />}
        type="primary"
        aria-label="问 AI"
        tooltip={{
          title: !config
            ? "打开项目后可用"
            : currentFocus
              ? "带着当前页面上下文去问 AI"
              : "去问 AI",
          placement: "left",
        }}
        onClick={() => {
          if (!config) {
            useUiStore.getState().showToast("打开项目后可用", "info");
            return;
          }
          setFocusContext(currentFocus);
          requestFocusInput();
          const opened = onOpenChat(); // 右栏本就可见 → false
          // 无页面焦点（未进入任何具体条目）且右栏本就可见：聚焦输入框过于隐形，补中性提示说明本次点击
          if (!currentFocus && !opened) {
            useUiStore.getState().showToast("未选中具体条目，可直接在右栏提问", "info");
          }
        }}
        style={{ position: "absolute", insetInlineEnd: 16, bottom: 16, zIndex: 30 }}
      />
    </main>
  );
}
