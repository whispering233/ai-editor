// 可点的内联引用 chip（契约：DESIGN.md §Components `ref-chip`）
//
// 三分法（调用点必须显式选一个）：
// - `TagChip`  = 用户数据（`data.tags`）：tint 实底 + 墨字，静态
// - `TypeChip` = 枚举结构（卷/章/场、实体类型、关系类型…）：描边 + 墨字，静态、无 hover
// - 本组件     = **可点**：描边 + hover 面，视觉体量必须等于周围文字
//
// 为什么不能给 `TypeChip` 加 `onClick`：那会把 hover / 焦点语言带进「描边 = 类型」的信号里，
// 静态徽标与可点引用就再也分不出来。
//
// 几何（DESIGN.md §Shapes）：`{rounded.xs}`(4px) = 小内衬块档，不是按钮的 6px——可点 chip 的体量
// 必须等于文字，吃按钮圆角会显得像「小按钮」。**不设字号**：嵌在正文行里跟 14px、嵌在元信息行里
// 跟 12px，钉死任一档都会把另一档改错（由调用点 `className` 决定，同 `lib/styles.ts` 的易变属性口径）。
//
// 判据（DESIGN.md 同条）：① 文字流里、体量等于周围文字 → 本组件；② 独立成行的导航动作
// （「去回收站」/「返回列表」）→ `<Button href>`；③ 空态/错误文案里的逃生链接 → 现状另论。
import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 壳串：改这里等于改全部 8 处（`design-discipline.test.ts` 的 `ref-chip-shell` 守卫锁住复制） */
const SHELL_CLASS =
  "inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 hover:bg-muted";

/** 三档语义色（每一档都有现网调用点背书，不是先造 API 再找用法）：
 * - `default` 墨字——跨页引用（上级 / 子设定 / 挂载节点）
 * - `muted`   灰字、hover 转墨——弱动作（展开变更记录 / 依赖链）
 * - `primary` 主色——强调动作（描述「展开 / 收起」）*/
const TONE_CLASS = {
  default: "text-foreground",
  muted: "text-muted-foreground hover:text-foreground",
  primary: "text-primary",
} as const;

export type RefChipTone = keyof typeof TONE_CLASS;

export interface RefChipProps {
  children: ReactNode;
  /** 跳转目标（不含 `#`，如 `/setting/abc`）→ 渲染 `<a href="#…">`，保住中键 / `⌘`+点击新标签页。
   * 需要过未保存守卫时与 `onClick` 同时给：调用点 `preventDefault()` 后先问再 `navigate`
   * （写法见 `SettingWorkbench` 的「设定树」返回条）。 */
  to?: string;
  /** 非跳转动作（toggle / 追加）→ 渲染 `<button type="button">`；与 `to` 共存时收到的是锚点事件 */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  tone?: RefChipTone;
  /** 展开类动作的可访问性；缺省不渲染该属性 */
  ariaExpanded?: boolean;
  /** 防拖：行根 `draggable` 的场合（时间轴事件行）必须给 `false`，否则本控件会把整行拖起来 */
  draggable?: boolean;
  /** 附加类：`ml-1` / `shrink-0` / `min-w-0` / `truncate` / `text-left` / `text-xs` 由调用点给 */
  className?: string;
  title?: string;
}

export function RefChip({
  children,
  to,
  onClick,
  tone = "default",
  ariaExpanded,
  draggable,
  className,
  title,
}: RefChipProps) {
  const shell = cn(SHELL_CLASS, TONE_CLASS[tone], className);
  // 焦点不自立语言：沿用 index.css 的 `* { outline-ring/50 }`，与其它原生可点控件同一档
  // （DESIGN.md 已禁「彩色 focus 环」，这里不开例外）。
  if (to !== undefined) {
    return (
      <a href={`#${to}`} onClick={onClick} draggable={draggable} title={title} className={shell}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      title={title}
      aria-expanded={ariaExpanded}
      className={shell}
    >
      {children}
    </button>
  );
}
