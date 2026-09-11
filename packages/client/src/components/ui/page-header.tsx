// 页头壳（T2）：全站中栏页面头部的**唯一实现**——契约见 DESIGN.md §Layout「中栏页头结构」。
// 结构（自上而下）：标题行（`PageTitle`，每页一个）+ 标题行右侧操作区 → 说明行（可选）→
// 二级 tab 行（可选）→ 控件行（可选）→ 分割线 → （调用方的内容区块）。
//
// ⚠ 分割线规则（契约红线，不要各页自画）：
// - 有 `tabs`：**不画**分割线——antd line 型 `Tabs` 的导航条自带 1px `{colors.hairline}` 底线即分割线
//   （配套 `AntdProvider` 的 `Tabs.horizontalMargin: 0`，否则底线与内容之间留 16px 空档）。
// - 无 `tabs`：画 1px `{colors.hairline}`（= Tailwind `bg-border`，与 `info-bar` 底线同档）。
// - 控件行由子视图渲染的页（设定树 / 关联总览：工具栏随各自视图结构）传 `divider={false}`，
//   由那两处在控件行之后自放 `<PageDivider />`——仍复用本模块的唯一实现，不另起分割线写法。
// - 宽度：与内容区块同宽（不穿透中栏内容区内边距）；间距：页头到内容 16px、页头内部 12px。
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { PageTitle } from "./page-title";

/** 页头分割线（1px 结构描边；`PageHeader` 内部与「控件行在子视图」的两页共用同一实现） */
export function PageDivider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full shrink-0 bg-border", className)} />;
}

export interface PageHeaderProps {
  /** 页面标题（每页一个） */
  title: ReactNode;
  /** 标题行右侧操作区（刷新/保存/删除/新建等，靠右对齐） */
  action?: ReactNode;
  /** 说明行（标题行下方；字号/颜色由调用方给，如 `text-sm text-muted-foreground`） */
  description?: ReactNode;
  /** 二级 tab 行（当前仅设置页）：给出时分割线由 tab 条底线承担 */
  tabs?: ReactNode;
  /** 控件行：左 = 搜索框（恒最左，192px）/筛选，右 = 操作按钮（`ml-auto`） */
  controls?: ReactNode;
  /** 是否画显式分割线（默认画；有 `tabs` 时忽略） */
  divider?: boolean;
  /** 标题超长截断（详情页/长标题页用） */
  truncateTitle?: boolean;
  /** 页头整体附加类（如 `mt-8`；间距缺省 `mb-4`） */
  className?: string;
}

export function PageHeader({
  title,
  action,
  description,
  tabs,
  controls,
  divider = true,
  truncateTitle,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-4 flex shrink-0 flex-col", className)}>
      <div className="flex items-center gap-3">
        <PageTitle className={cn("min-w-0", truncateTitle && "truncate")}>{title}</PageTitle>
        {action !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>
        )}
      </div>
      {description !== undefined && <div className="mt-1">{description}</div>}
      {tabs !== undefined && <div className="mt-3">{tabs}</div>}
      {controls !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-3">{controls}</div>
      )}
      {tabs === undefined && divider && (
        <div className="mt-3">
          <PageDivider />
        </div>
      )}
    </header>
  );
}
