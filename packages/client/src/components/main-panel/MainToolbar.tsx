// 中栏工具栏（DESIGN.md §Components `main-toolbar`）：**只承载全局操作，不承载项目信息**——
// 品牌标记 / 项目名 / 阅读进度 / 语言都不在这里（项目名见左栏书名按钮，阅读进度与语言见概览页 / 大纲页），
// 故本组件**不读项目配置、不按工作区类型（`kind`）分叉**：`novel` / `practice` 同形。
// 桌面态：右端组 = 刷新（`ml-auto` 起右对齐）；**不含整栏开关**——那两枚由外壳 `ShellPanelToggles`
// 锚定视口顶带两角（DESIGN.md §Layout「三栏」），本工具栏只在左 / 右栏收起时让出 48px 槽位
// （`pl-12` / `pr-12`，与 `pl-4` / `pr-4` 互斥，不写 `px-*` 以免同属性覆盖顺序不确定）。
// 窄屏（<1024px）：右栏是抽屉，开关 = `MessageOutlined`；此态没有顶带开关，故恒 `pl-4` / `pr-4`。
// 刷新按钮：MainToolbar 是中栏统一头部（全 tab 常驻），在此放刷新 = 一个入口刷所有数据页——
// 点击调 ui store notifyDataChanged（1），各数据页订阅后重拉。
// 实体列表错误横幅内的「重试」按钮保留：那是错误态行内重试（错误时用户不一定会想到顶部刷新），
// 与全局刷新不构成重复（不同状态上下文、不同语义）
import { Button } from "antd";
import { MessageOutlined, ReloadOutlined } from "@ant-design/icons";
import { cn } from "../../lib/utils";
import { useUiStore } from "../../stores/ui";

export function MainToolbar({
  chatOpen,
  onToggleChat,
  isDesktop,
  sidebarCollapsed,
  chatCollapsed,
}: {
  chatOpen: boolean;
  /** 小屏右栏抽屉开关（桌面态不渲染该按钮） */
  onToggleChat: () => void;
  /** 桌面标记（与三栏装配同一判定）：顶带开关仅桌面存在，槽位也只在桌面让出 */
  isDesktop: boolean;
  /** 左栏收起态：桌面收起时工具栏左端起于开关右侧 48px 槽位之外（16 槽 + 24 钮 + 8 呼吸） */
  sidebarCollapsed: boolean;
  /** 右栏收起态：桌面收起时工具栏右端止于开关左侧 48px 槽位之内（16 槽 + 24 钮 + 8 呼吸） */
  chatCollapsed: boolean;
}) {
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);

  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center gap-3 border-b border-border",
        isDesktop && sidebarCollapsed ? "pl-12" : "pl-4",
        isDesktop && chatCollapsed ? "pr-12" : "pr-4",
      )}
    >
      {/* 右端组：刷新（`ml-auto` 起右对齐）+ 小屏聊天开关
          （问 AI 入口已迁至中栏右下悬浮按钮——C1） */}
      <Button
        color="default" variant="text"
        size="small"
        className="ml-auto shrink-0"
        onClick={notifyDataChanged}
        icon={<ReloadOutlined className="text-base" />}
        aria-label="刷新数据"
        title="刷新数据"
      />
      {!isDesktop && (
        <Button
          color="default" variant={chatOpen ? "filled" : "text"}
          size="small"
          onClick={onToggleChat}
          icon={<MessageOutlined className="text-base" />}
          aria-label={chatOpen ? "关闭聊天面板" : "打开聊天面板"}
        />
      )}
    </div>
  );
}
