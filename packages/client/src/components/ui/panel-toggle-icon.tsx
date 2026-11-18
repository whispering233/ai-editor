// 面板开关图标 `PanelToggleIcon`（DESIGN.md §Components `panel-toggle-icon`，全站唯一实现）。
// 几何 = **圆角矩形 + 内侧竖线**：矩形 = 一整栏面板，竖线 = 该栏的侧边线；`side` 决定竖线靠左 / 靠右
// （左栏 → 靠左、右栏 → 靠右镜像）。语义是「收 / 展某一面板栏」，**不表达方向**——图标静态不随收起态换向，
// 状态一律由调用点的动态 `aria-label` / `title` / `aria-expanded` 承载（见 DESIGN.md `icon-button`）。
// 约束（改几何/取色前先读该条目）：
// - **色一律 `currentColor`**、`fill="none"`：色随 `{colors.primary}`，文件内不得出现任何字面色值。
// - **无尺寸 / 色值 API**：24 viewBox + 固定 16px 显示（约 1.8 stroke），`className` 只做上下文附加类合并。
// - **只服务面板开关**：main-toolbar 两端 + 写作 / 大纲 / 设定三页子栏（经 `PanelToggleButton`）；
//   其余图标仍 `@ant-design/icons`，不得用于树行折叠 / accordion / 章节导航。
import { cn } from "../../lib/utils";

export interface PanelToggleIconProps {
  /** 面板所在侧：左栏 = 竖线靠左，右栏 = 竖线靠右 */
  side: "left" | "right";
  /** 上下文附加类（外边距 / 对齐由调用点给；`shrink-0` 已默认内置） */
  className?: string;
}

/** 整栏收起/展开图标（静态面板图形）：main-toolbar 左端 `side="left"`、右端 `side="right"` */
export function PanelToggleIcon({ side, className }: PanelToggleIconProps) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect x={3} y={4} width={18} height={16} rx={2.5} />
      <path d={side === "left" ? "M9 4 V20" : "M15 4 V20"} />
    </svg>
  );
}
