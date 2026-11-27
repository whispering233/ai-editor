// 保存失败提示（DESIGN.md §Components `save-error`）：14px（body 档）+ `{colors.error}`。
//
// 与 `field-error` 的分工是**落点**，不是颜色：
// - 能指明「哪个字段错了」→ `field-error`（就地挂在字段下）；
// - 只能说明「这次没存上」（网络 / 409 / 服务端拒绝）→ 本组件（表单区块底部 / 弹窗底部，提交动作旁）。
// 两者语义不得互换：把服务端错误塞进字段下会指错地方，把字段校验丢到页脚会让用户找不到。
//
// 外边距同样由调用点 `className` 传。
import type { ReactElement, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function SaveError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <p className={cn("text-sm text-destructive", className)}>{children}</p>;
}