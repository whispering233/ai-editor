// 错误条唯一实现（DESIGN.md §Components `error-banner`）。
//
// 为什么收口：此前 `lib/styles.ts` 的 `errorBannerClass` 只给壳子，几何由 12 个文件各自拼——
// `gap-2` 与 `gap-3` 并存、消息 `ml-auto` 与按钮 `min-w-0 flex-1` 两种布局、重试按钮位置两种对齐。
// 壳类串只在这里出现一次；页面 / 栏内错误条一律走本组件。
//
// 两个布局：
// - `row`（缺省）= 一行说明 + 右端按钮（保存失败 / 刷新失败的内联条）
// - `stack` = 说明 + 垂直排列的 block 按钮（rail 与整页错误态）
//
// 约定：
// - **外边距不进组件**：`mb-*` / `mt-*` / `m-*` 由调用点 `className` 传（同 `lib/styles.ts` 的
//   「易变属性由调用点决定」——常量一旦含间距类，调用点无法用排序更早的类覆盖）。
// - `onRetry` 缺省时不渲染重试按钮；额外动作（「返回列表」/「还原上级」）走 `actions`，
//   尺寸由调用点决定（不在这里统一改别人的按钮高度）。
// - 不属于本控件的三种错误面：`ErrorBoundary` 整页兜底 / `FeedbackHost` 全局 fixed 横幅 /
//   `compute-preview` 带图标与条目列表的「状态冲突」警示块——形态与语义都不同，不要迁进来。
import type { ReactNode } from "react";
import { Button } from "antd";

import { cn } from "@/lib/utils";

const SHELL =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive";

export interface ErrorBannerProps {
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** 额外动作（非重试语义的按钮），尺寸由调用点给 */
  actions?: ReactNode;
  layout?: "row" | "stack";
  /** 只承载外边距（`mb-3` / `mt-2` / `shrink-0` …） */
  className?: string;
}

export function ErrorBanner({
  message,
  onRetry,
  retryLabel = "重试",
  actions,
  layout = "row",
  className,
}: ErrorBannerProps) {
  if (layout === "stack") {
    return (
      <div className={cn(SHELL, "flex flex-col gap-2", className)}>
        <span className="min-w-0">{message}</span>
        {(onRetry !== undefined || actions !== undefined) && (
          <div className="flex flex-col gap-2">
            {onRetry !== undefined && (
              <Button size="small" block onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cn(SHELL, "flex items-center gap-3", className)}>
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry !== undefined && (
        <Button size="small" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
      {actions}
    </div>
  );
}
