// 中栏工具栏（DESIGN.md §Components `main-toolbar`）：**只承载全局操作，不承载项目信息**——
// 品牌标记 / 项目名 / 阅读进度 / 语言都不在这里（项目名见左栏书名按钮，阅读进度与语言见概览页 / 大纲页），
// 故本组件**不读项目配置、不按工作区类型（`kind`）分叉**：`novel` / `practice` 同形。
// 桌面态：左端 = 左栏展开/收起（项目语境之前）→ 右端组 = 刷新（`ml-auto` 起右对齐）+ 右栏展开/收起；
// 窄屏（<1024px）：不渲染两枚整栏 toggle（右栏是抽屉，开关 = `MessageOutlined`）+ 刷新。
// 整栏 toggle 的图标 = 静态 `PanelToggleIcon`，状态只由动态 `aria-label` / `title` / `aria-expanded`
// 表达（DESIGN.md §Components `icon-button`）；桌面标记由 `MainPanel` 的 `isDesktop` 透传
// （与三栏装配同一判定，不在此另建媒体查询）。
// 刷新按钮：MainToolbar 是中栏统一头部（全 tab 常驻），在此放刷新 = 一个入口刷所有数据页——
// 点击调 ui store notifyDataChanged（1），各数据页订阅后重拉。
// 实体列表错误横幅内的「重试」按钮保留：那是错误态行内重试（错误时用户不一定会想到顶部刷新），
// 与全局刷新不构成重复（不同状态上下文、不同语义）
import { Button } from "antd";
import { MessageOutlined, ReloadOutlined } from "@ant-design/icons";
import { PanelToggleIcon } from "../ui/panel-toggle-icon";
import { useUiStore } from "../../stores/ui";

/** 整栏收起/展开（桌面态）：三栏的收起态与动作由 `AppShell` 提供（状态仍在 `usePanels`） */
export interface PanelToggles {
  sidebarCollapsed: boolean;
  chatCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
}

export function MainToolbar({
  chatOpen,
  onToggleChat,
  isDesktop,
  panelToggles,
}: {
  chatOpen: boolean;
  /** 小屏右栏抽屉开关（桌面态不渲染该按钮） */
  onToggleChat: () => void;
  /** 桌面标记（与三栏装配同一判定）：整栏两枚 toggle 仅桌面渲染 */
  isDesktop: boolean;
  panelToggles: PanelToggles;
}) {
  const {
    sidebarCollapsed,
    chatCollapsed,
    onToggleSidebar,
    onToggleChat: onToggleChatPanel,
  } = panelToggles;
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      {/* 左端：左栏收起/展开（桌面态）。图标静态、不加选中面——
          状态只经 `aria-label` / `title` / `aria-expanded`（DESIGN.md §Components `main-toolbar`） */}
      {isDesktop && (
        <Button
          color="default" variant="text"
          size="small"
          className="shrink-0"
          onClick={onToggleSidebar}
          icon={<PanelToggleIcon side="left" />}
          aria-label={sidebarCollapsed ? "展开左栏" : "收起左栏"}
          title={sidebarCollapsed ? "展开左栏" : "收起左栏"}
          aria-expanded={!sidebarCollapsed}
        />
      )}

      {/* 右端组：刷新（`ml-auto` 起右对齐）+ 右栏 toggle（桌面）+ 小屏聊天开关
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
      {isDesktop && (
        <Button
          color="default" variant="text"
          size="small"
          className="shrink-0"
          onClick={onToggleChatPanel}
          icon={<PanelToggleIcon side="right" />}
          aria-label={chatCollapsed ? "展开右栏" : "收起右栏"}
          title={chatCollapsed ? "展开右栏" : "收起右栏"}
          aria-expanded={!chatCollapsed}
        />
      )}
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
