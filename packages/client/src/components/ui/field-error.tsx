// 字段级错误（DESIGN.md §Components `field-error`）：12px（caption 档）+ `{colors.error}`，无图标。
//
// 唯一实现：调用点不再手写 `text-xs text-destructive`（同样的两个 token 被抄了 30+ 遍，
// 字号还会就地漂移成 14px）。落点是契约——**挂在字段控件正下方**；服务端返回的字段级错误同理。
//
// 外边距不进组件：`mt-*` 由调用点 `className` 传（同 `error-banner` 的口径——
// 常量一旦含间距，调用点就无法用排序更早的类覆盖）。
import type { ReactElement, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function FieldError({
  children,
  className,
  as = "p",
}: {
  children: ReactNode;
  className?: string;
  /** 极紧的行内位置（chips 行 / 表单控件旁）用 `span`；其余一律 `p` */
  as?: "p" | "span";
}): ReactElement {
  const Tag = as;
  return <Tag className={cn("text-xs text-destructive", className)}>{children}</Tag>;
}