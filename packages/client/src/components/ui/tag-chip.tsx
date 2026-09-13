// 徽标 chip 的两个形态（DESIGN.md §Components `tag` / `type-badge`，全站各自唯一实现）：
// - `TagChip`  = **用户标签**（`data.tags` 数组元素）：tint 六色底 + 墨字
// - `TypeChip` = **类型/分类徽标**（卷/章/场、实体类型、端点类型、关系类型、伏笔 category、回收站类型）：
//               **固定橙底 `#ef8354` + 恒定墨字 `#37352f`**（两态不翻转：`text-foreground` 在深色态会
//               翻成 81% 白，压橙底只有 2.61:1，而恒定墨字 4.70:1）——枚举类型用一个固定识别色
// 准入规则（2026-09 收口，别再扩散）：tint 只给用户标签。枚举类型是「结构」不是用户数据，逐个发彩色
// 只会让「彩色 = 这是标签」的信号失效（历史上同一类「类型」在大纲页/关联页/回收站页有色、人物页无色，
// 每页各自发挥）。判据的代码形式 = 两个组件名，调用点必须显式选一个。
//
// 为什么不用 antd `Tag`：`Tag` 的底色由组件 token 统一派发（`defaultBg`），要上 tint 只能用
// preset 色名或内联色值——前者是 antd 默认色板（全站禁 preset）、后者违反「禁硬编码色值」。
// 自绘 span + `bg-tag-*`/`bg-accent` token 类则让色值仍只定义在 `index.css`/`AntdProvider` 两处。
// antd `Tag` 仅保留给「带交互的元信息 chip」（如会话 focus 小条的 closable 标签）。
import type { ReactNode } from "react";
import { tagTintClass } from "../../lib/tag-tint";
import { cn } from "../../lib/utils";

/** 两形态共用的形状类（同尺寸同字号，只差底色/字色——类型徽标与标签并排时基线一致） */
const CHIP_BASE = "inline-flex items-center rounded-sm px-1 py-0.5 text-xs whitespace-nowrap";

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

/** 用户标签 chip（tint 六色底 + 墨字）：**只给 `data.tags` 元素**，枚举类型请用 `TypeChip` */
export function TagChip({ children, label: labelProp, className, title }: TagChipProps) {
  // 取色 key：显式 label 优先，其次单个字符串 children；都没有 → 空串（回落首色，不抛错）
  const label = labelProp ?? (typeof children === "string" ? children : "");
  return (
    <span title={title} className={cn(CHIP_BASE, "text-foreground", tagTintClass(label), className)}>
      {children}
    </span>
  );
}

export interface TypeChipProps {
  children: ReactNode;
  /** 上下文附加类（截断 / 伸缩 / 外边距由调用点给） */
  className?: string;
}

/** 类型/分类徽标（中性底 + 墨字，尺寸/字色与 `TagChip` 一致——两形态只差底色有无色相）：
 * 卷/章/场、实体类型、端点类型、关系类型、回收站类型 */
export function TypeChip({ children, className }: TypeChipProps) {
  return <span className={cn(CHIP_BASE, "bg-type-badge text-type-badge-fg", className)}>{children}</span>;
}
