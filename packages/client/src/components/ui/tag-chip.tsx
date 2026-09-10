// 标签/类型 chip（DESIGN.md §Components `tag`，全站唯一实现）：tint 六色底 + 墨字 + caption 字号 + rounded.xs。
// 为什么不用 antd `Tag`：`Tag` 的底色由组件 token 统一派发（`defaultBg`），要上 tint 只能用
// preset 色名或内联色值——前者是 antd 默认色板（全站禁 preset）、后者违反「禁硬编码色值」。
// 自绘 span + `bg-tag-*` token 类则让色值仍只定义在 `index.css` 一处。
// antd `Tag` 仅保留给「带交互的元信息 chip」（如会话 focus 小条的 closable 标签）。
import type { ReactNode } from "react";
import { tagTintClass } from "../../lib/tag-tint";
import { cn } from "../../lib/utils";

export interface TagChipProps {
  children: ReactNode;
  /** 上下文附加类（截断 `max-w-full truncate` / 伸缩 `shrink-0` / 外边距由调用点给） */
  className?: string;
  /** hover 提示（截断场景给完整文案） */
  title?: string;
}

export function TagChip({ children, className, title }: TagChipProps) {
  // 文案即取色 key：children 非字符串（富内容 chip）时回落到空串 → 首色，不报错
  const label = typeof children === "string" ? children : "";
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-sm px-1 py-0.5 text-xs text-foreground",
        tagTintClass(label),
        className,
      )}
    >
      {children}
    </span>
  );
}
