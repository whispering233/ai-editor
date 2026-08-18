// 空态容器（layout.md §4.3 空态规范 + §4.4 L 批次组件契约）：虚线边框居中卡 + 说明文案 + 可选主操作
// 用法：
//   <EmptyState>还没有书，先创建一本</EmptyState>
//   <EmptyState icon={<BookOpen className="size-7 text-muted-foreground/40" />}
//     action={<Button onClick={...}>去大纲</Button>}>大纲还是空的</EmptyState>
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 内边距档位（默认 md = py-12；sm = py-10 / lg = py-14；⚠ py-* 按值排序，调用点无法用更小的 py 覆盖，故参数化） */
const PADDING_CLASS = {
  sm: "py-10",
  md: "py-12",
  lg: "py-14",
} as const;

export interface EmptyStateProps {
  /** 说明文案（一行文字） */
  children: ReactNode;
  /** 可选图标（约定 size-7/8 text-muted-foreground/40，layout.md §4.3） */
  icon?: ReactNode;
  /** 主操作按钮区（渲染于文案下方，自带 mt-4） */
  action?: ReactNode;
  /** 内边距档位：sm = py-10 / md = py-12（默认）/ lg = py-14 */
  padding?: keyof typeof PADDING_CLASS;
  /** 覆盖类（如 mt-3 / rounded-md——rounded-md 排序在 rounded-lg 后，可覆盖） */
  className?: string;
}

/** 空态容器：`rounded-lg border-dashed px-6 text-center` 基座 + 文案 + 图标 + 主操作（统一全仓空态样式） */
export function EmptyState({ children, icon, action, padding = "md", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border px-6 text-center",
        PADDING_CLASS[padding],
        className,
      )}
    >
      {icon}
      <p className="text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
