// 页面标题薄壳（批次十九 T2）：全站页面级标题的唯一实现（替换手写 <h1> 与裸 Typography.Title level={4}）。
// 规格 = DESIGN.md §Typography `page-title`（20px / 600 / 行高 1.4）= antd `Typography.Title level={4}`
// （antd v6 派生值：fontSizeHeading4 20px、lineHeightHeading4 28px、字重 = fontWeightStrong 600，与文档同值）。
// ⚠ 标题下边距归零不在本壳内联处理：由 antd 组件 token `Typography.titleMarginBottom: 0` 统一生效
// （覆盖登记在 `AntdProvider.tsx` 与 DESIGN.md §Components 覆盖表）；垂直间距一律由父容器提供（mb-* / space-y-*）
// —— 这样避免了内联 style，也避开了「Tailwind mb-* 压不动 antd 自带 margin」而被迫用 `!` 前缀类的老问题。
// ⚠ antd 按 level 决定渲染标签（Title.js: `h${level}`，调用点传 component 会被其覆盖），故本壳渲染 <h4>；
// 语义层级由 level 决定，不再额外传标签，也不要为此改用 h1 视觉档（那会变成 fontSizeHeading1 = 38px）。
import type { ReactNode } from "react";
import { Typography } from "antd";

export interface PageTitleProps {
  children: ReactNode;
  /** 附加类（如详情页标题的 `min-w-0 truncate`） */
  className?: string;
  /** 可编辑标题场景（参考资料详情：点击标题进编辑态） */
  onClick?: () => void;
  /** 与 onClick 配套的提示文案 */
  title?: string;
}

export function PageTitle({ children, className, onClick, title }: PageTitleProps) {
  return (
    <Typography.Title level={4} className={className} onClick={onClick} title={title}>
      {children}
    </Typography.Title>
  );
}
