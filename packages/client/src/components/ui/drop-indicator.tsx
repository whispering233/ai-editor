// 拖拽插入线（全站唯一实现，视觉契约见 DESIGN.md §Components `drag-indicator`）：
// primary（墨）实线 3px + 两端 8px 圆点，压在目标行上/下边缘（-3px 偏移让线跨在行缝上，视觉上更「插在中间」）。
// 为什么是 primary 而不是 surface-muted：近白面在白底上对比度 ~1.06:1，等于没有指示（历史事故：
// 大纲页插入线曾用 bg-accent，用户反馈「拖拽完全没有插入线」）。pointer-events-none 不拦行级 dragover/drop。
import { cn } from "../../lib/utils";

export interface DropIndicatorProps {
  /** top = 插到该行之前；bottom = 插到该行之后 */
  position: "top" | "bottom";
}

export function DropIndicator({ position }: DropIndicatorProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 flex items-center",
        position === "top" ? "-top-[3px]" : "-bottom-[3px]",
      )}
    >
      <span className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="h-[3px] flex-1 rounded-full bg-primary" />
      <span className="size-2 shrink-0 rounded-full bg-primary" />
    </div>
  );
}
