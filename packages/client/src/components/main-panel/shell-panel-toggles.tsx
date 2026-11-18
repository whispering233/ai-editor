// 整栏开关（DESIGN.md §Layout「三栏」子条「整栏开关锚定视口顶带两角」/ §Components `panel-toggle-icon`）：
// 左栏 / 右栏的收起展开**不在中栏工具栏、也不在任何会伸缩的列里**——两枚 `PanelToggleButton` 由外壳常驻渲染，
// 绝对定位于应用根两角（y 恒 12px；左钮 `left:16px`、右钮 `right:16px`），坐标只由视口决定 ⇒ 拖拽栏宽、
// 收起 / 展开都不移动、不卸载（焦点保留、连点不丢）。三段 48px 顶带按可见性由各栏自己让出 48px 槽位（16 槽 + 24 钮 + 8 呼吸）
// （`reserveShellToggle`），使栏内内容起点不随收起态跳动。
// 面板内子栏的开关仍按外端锚定放在 `PanelHeader`（两套口径不得互换）。
import { PanelToggleButton } from "../ui/panel-toggle-button";

export interface ShellPanelTogglesProps {
  sidebarCollapsed: boolean;
  chatCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleChat: () => void;
}

/** 视口顶带两角的整栏开关（桌面且非专注模式时由 `AppShell` 常驻渲染） */
export function ShellPanelToggles({
  sidebarCollapsed,
  chatCollapsed,
  onToggleSidebar,
  onToggleChat,
}: ShellPanelTogglesProps) {
  return (
    <>
      <div className="absolute left-4 top-3">
        <PanelToggleButton
          side="left"
          collapsed={sidebarCollapsed}
          label="左栏"
          onToggle={onToggleSidebar}
        />
      </div>
      <div className="absolute right-4 top-3">
        <PanelToggleButton
          side="right"
          collapsed={chatCollapsed}
          label="右栏"
          onToggle={onToggleChat}
        />
      </div>
    </>
  );
}
