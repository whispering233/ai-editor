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
  /** 取色 key（可选）：children 非单个字符串时（数组/富内容，如「关系类型 →」）必须显式给，
   * 否则会退化为首色——同一类 chip 全一个色，等于没上色（实测：关系类型列恒 peach） */
  label?: string;
  /** 上下文附加类（截断 `max-w-full truncate` / 伸缩 `shrink-0` / 外边距由调用点给） */
  className?: string;
  /** hover 提示（截断场景给完整文案） */
  title?: string;
}

export function TagChip({ children, label: labelProp, className, title }: TagChipProps) {
  // 取色 key：显式 label 优先，其次单个字符串 children；都没有 → 空串（回落首色，不抛错）
  const label = labelProp ?? (typeof children === "string" ? children : "");
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-sm px-1 py-0.5 text-xs whitespace-nowrap text-foreground",
        tagTintClass(label),
        className,
      )}
    >
      {children}
    </span>
  );
}
