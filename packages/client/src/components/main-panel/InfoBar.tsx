// 中栏信息条：项目名（点击进 #/overview 项目概览）+ 阅读进度（outline 树映射，点击跳 #/outline 并定位）+ 语言
// **形态按工作区类型（`kind`）**：小说工作区 = 上面两句；练习工作区 = 项目名**纯文本（无 href）** + **无阅读进度**
// （它没有项目概览页，`#/overview` 与 `#/outline` 都被路由守卫挡回 `#/practice`——留着就是「点了没反应」的死链），
// 语言与小屏聊天开关两种 kind 都保留。
// 数据源 stores/project.ts（GET /api/v1/project/config）；加载失败保持 null 显示「书架」不阻塞；
// 阅读进度标题由 outline 树 id→title 映射（findOutlineNodeTitle）
// 定位实现（U4 方案 A）：点击阅读进度 → ui store 设置 focusOutlineNodeId（transient）→ 跳 #/outline，
// Outline 页消费（展开祖先+滚动+高亮）后清除；不侵入 hash 路由
// <1024px 时右栏为抽屉：信息条右侧显示聊天开关
// 整栏收起/展开（2026-11）：桌面态左端 = 左栏 toggle（项目名之前）、右端 = 右栏 toggle（语言之后），
// 图标 = 静态 `PanelToggleIcon`，状态只由动态 `aria-label` / `title` / `aria-expanded` 表达（DESIGN.md
// §Components `icon-button`）；窄屏不渲染这两枚（右栏仍是抽屉，开关是 `MessageOutlined`）。
// 桌面标记由 `MainPanel` 的 `isDesktop` 透传（与三栏装配同一判定，不在此另建媒体查询）。
// 刷新按钮（问题 1）：InfoBar 是中栏统一头部（全 tab 常驻），在此放刷新 = 一个入口
// 刷所有数据页——点击调 ui store notifyDataChanged（1），各数据页订阅后重拉。
// 实体列表错误横幅内的「重试」按钮保留：那是错误态行内重试（错误时用户不一定会想到顶部刷新），
// 与全局刷新不构成重复（不同状态上下文、不同语义）
import { Button } from "antd";
import { MessageOutlined, ReloadOutlined } from "@ant-design/icons";
import { AppMark } from "../brand/app-mark";
import { PanelToggleIcon } from "../ui/panel-toggle-icon";
import { findOutlineNodeTitle, useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";

/** 整栏收起/展开（桌面态）：三栏的收起态与动作由 `AppShell` 提供（状态仍在 `usePanels`） */
export interface PanelToggles {
  sidebarCollapsed: boolean;
  chatCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
}

export function InfoBar({
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
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const outline = useProjectStore((s) => s.outline);
  const setFocusOutlineNode = useUiStore((s) => s.setFocusOutlineNode);
  const notifyDataChanged = useUiStore((s) => s.notifyDataChanged);

  // 阅读进度：null → 「未设置」；有 id 时优先 outline 树映射标题，未加载 outline 则显示 id 占位
  const positionTitle =
    config?.currentPosition != null
      ? (findOutlineNodeTitle(outline, config.currentPosition) ?? config.currentPosition)
      : null;

  // 项目名：加载中 → 「加载中…」；未打开/加载失败 → 「书架」（无项目时所在即书架形态）
  const projectTitle = configLoading ? "加载中…" : (config?.name ?? "书架");
  const isPractice = config?.kind === "practice";

  // 项目名内容两种 kind 逐字相同（只有外层的链接形态分叉）
  const projectName = (
    <>
      <AppMark />
      <span className="truncate">{projectTitle}</span>
    </>
  );

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      {/* 左端：左栏收起/展开（桌面态；项目名之前）。图标静态、不加选中面——
          状态只经 `aria-label` / `title` / `aria-expanded`（DESIGN.md §Components `info-bar`） */}
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

      {/* 项目名：小说工作区 = 链接进项目概览（与左栏书名按钮同一目标；书架入口在左栏顶部「书架」）；
       * 练习工作区没有概览页 ⇒ 纯文本，不挂 href（否则是死链） */}
      {isPractice ? (
        <span className="flex min-w-0 items-center gap-1.5 text-base font-medium text-foreground">
          {projectName}
        </span>
      ) : (
        <a
          href="#/overview"
          title="打开项目概览"
          className="flex min-w-0 items-center gap-1.5 text-base font-medium text-foreground hover:text-primary"
        >
          {projectName}
        </a>
      )}

      {/* 阅读进度（小说语义：练习工作区没有 `current_position`）⇒ 仅小说工作区渲染；
       * 点击跳 #/outline 并定位该节点（U4：ui store transient focusOutlineNodeId，
       * Outline 页消费后清除；未设置阅读进度时仅跳转不定） */}
      {!isPractice && (
        <a
          href="#/outline"
          onClick={() => {
            if (config?.currentPosition != null) setFocusOutlineNode(config.currentPosition);
          }}
          title={config?.currentPosition != null ? "跳转大纲并定位该节点" : undefined}
          className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="shrink-0">阅读进度:</span>
          <span className="truncate text-foreground">{positionTitle ?? "未设置"}</span>
        </a>
      )}

      {/* 右侧：刷新 + 语言 + 右栏 toggle（桌面）+ 小屏聊天开关（问 AI 入口已迁至中栏右下悬浮按钮——C1） */}
      <Button
        color="default" variant="text"
        size="small"
        className="ml-auto shrink-0"
        onClick={notifyDataChanged}
        icon={<ReloadOutlined className="text-base" />}
        aria-label="刷新数据"
        title="刷新数据"
      />
      <span className="shrink-0 text-sm text-muted-foreground">
        语言: {config?.language ?? "—"}
      </span>
      {/* 右端：右栏收起/展开（桌面态；语言之后） */}
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
