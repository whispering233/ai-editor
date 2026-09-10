// 空态容器（ 空态规范 + §4.4 L 批次组件）：虚线卡 + 说明文案 + 可选图标/主操作
// 用法：
// <EmptyState>还没有书，先创建一本</EmptyState>
// <EmptyState icon={<BookOpen className="size-7 text-muted-foreground/40" />}
// action={<Button onClick={...}>去大纲</Button>}>大纲还是空的</EmptyState>
import type { ReactNode } from "react";
import { Empty } from "antd";
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
  /** 可选图标（约定 size-7/8 text-muted-foreground/40，） */
  icon?: ReactNode;
  /** 主操作按钮区（渲染于文案下方，自带 mt-4） */
  action?: ReactNode;
  /** 内边距档位：sm = py-10 / md = py-12（默认）/ lg = py-14 */
  padding?: keyof typeof PADDING_CLASS;
  /** 覆盖类（如 mt-3 间距） */
  className?: string;
}

/** 空态容器：虚线卡基座（1px `{colors.hairline}` + `{rounded.md}`）+ antd `Empty` 文案 + 图标 + 主操作 */
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
      {/* image 必须传非 null 假值：antd v6 按 `image ?? contextImage ?? 默认插图` 合并，传 null 会回落默认插图；
          antd 的 -image 容器有 100px 高，故一并 hidden 去掉该占位 */}
      <Empty image={false} classNames={{ image: "hidden" }} description={children} />
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
