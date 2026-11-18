// 子栏面板开关 `PanelToggleButton`（DESIGN.md §Components `icon-button` / `panel-toggle-icon`）。
// 落点 = 写作 / 大纲 / 设定三页的面板内子栏（卷章栏、大纲树、设定树、以及三页右侧详情）：
// 内部 = 普通 `icon-button` 表皮（`color="default" variant="text" size="small"`，**不是圆钮**）+ 静态
// `PanelToggleIcon`，与外壳顶带两角的整栏开关（`ShellPanelToggles`）**共用同一面板图形**（同形 = 同一语义
// 「收 / 展一整栏」），靠位置区分控制哪一栏。`side` 由栏位决定（左栏 / 右栏），**图标不随收起态换向**——
// 状态只由这里统一生成的动态 `aria-label` / `title` / `aria-expanded` 表达；toggle 是瞬时动作，不加常驻选中面。
// 放置 = 最左可见列 `leading` / 最右可见列 `actions` 末尾（外端锚定，见 DESIGN.md §Layout「工作台子栏页头」）。
import { Button } from "antd";
import { PanelToggleIcon } from "./panel-toggle-icon";

export interface PanelToggleButtonProps {
  /** 被开关的栏位：`side` 只决定面板图形里竖线靠哪侧（左栏靠左、右栏靠右镜像） */
  side: "left" | "right";
  /** 该栏当前是否已收起（文案 = 收起 / 展开 + `label`） */
  collapsed: boolean;
  /** 栏名（如「卷章导航栏」「右侧详情」）：`aria-label` / `title` = `收起|展开` + 本值 */
  label: string;
  onToggle: () => void;
}

/** 面板内子栏的收起 / 展开按钮（静态面板图标 + 动态 aria / title） */
export function PanelToggleButton({ side, collapsed, label, onToggle }: PanelToggleButtonProps) {
  const text = `${collapsed ? "展开" : "收起"}${label}`;
  return (
    <Button
      color="default" variant="text"
      size="small"
      onClick={onToggle}
      icon={<PanelToggleIcon side={side} />}
      aria-label={text}
      title={text}
      aria-expanded={!collapsed}
    />
  );
}
