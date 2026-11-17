// 工作台子栏页头：写作 / 大纲 / 设定三页 master-detail 两列的**唯一实现**。
// 契约 = DESIGN.md §Layout「工作台子栏页头」——标题行 40px + 元信息行 24px + 1px 分割线，
// 两列分割线同落在内容顶下方 64px（标题行 40 + 元信息行 24，无额外外边距）。
//
// 与 `PageHeader` 的分工（两者不得互串）：普通中栏页面用 `PageHeader`（20px 标题、带 leading 可换行）；
// 本组件只给窄子栏——标题 16px / 600 单行截断不换行，操作一律 24px 图标按钮（文字按钮在窄列会折行）。
// 元信息行**恒渲染**：rail 侧留 24px 空带、详情侧空态 / 加载态同样留白，两列几何才逐像素同构。
// 横向内距只加在两行外层的包装上（`insetClassName`）；`PageDivider` 是 header 盒的直接子节点，
// 不吃内距 ⇒ 分割线全幅横贯列宽（2026-11 实测修复：此前内距加在 header 盒上，线两端各内缩）。
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { PageDivider } from "./page-header";

export interface PanelHeaderProps {
  /** 列标题（16px / 600，单行截断） */
  title: ReactNode;
  /** 标题行最左的前置元素（24px 图标，如左侧 rail 的收起 / 展开入口） */
  leading?: ReactNode;
  /** 标题行右端的操作组（24px 图标按钮，自带 `title` / `aria-label`） */
  actions?: ReactNode;
  /** 元信息行内容（单行、不折行）；不传 = 保留 24px 空带 */
  meta?: ReactNode;
  /** header 盒附加类（只放外边距 / 负边距，如详情列 `-mx-6`；横向内距走 `insetClassName`） */
  className?: string;
  /** 标题行 + 元信息行的横向内距（默认 `px-3`；详情列传 `px-6`）——分割线不吃内距，保持全幅 */
  insetClassName?: string;
}

export function PanelHeader({
  title,
  leading,
  actions,
  meta,
  className,
  insetClassName = "px-3",
}: PanelHeaderProps) {
  return (
    <header className={cn("mb-4 flex shrink-0 flex-col", className)}>
      <div className={cn("flex flex-col", insetClassName)}>
        <div className="flex h-10 min-w-0 items-center gap-2">
          {leading !== undefined && (
            <span className="flex shrink-0 items-center">{leading}</span>
          )}
          <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
          {actions !== undefined && (
            <span className="flex shrink-0 items-center gap-1">{actions}</span>
          )}
        </div>
        <div className="flex h-6 min-w-0 items-center gap-2">{meta}</div>
      </div>
      <PageDivider />
    </header>
  );
}
