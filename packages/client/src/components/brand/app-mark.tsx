// 品牌标记 `AppMark`（DESIGN.md §Components `app-mark`，全站唯一实现）。
// 几何 = **书脊 + 三条递减条目线**：竖脊 = 书 / 主干，右侧三条左对齐、长度递减的圆头线 = 卷 / 章 / 场三层
// ——语义是「有层级结构的书稿」，即本产品与「聊天框式 AI 写作」的分界。无外围容器。
// 约束（改几何/取色前先读 `app-mark` 条目）：
// - **色一律 `currentColor`**：浅色态即 `{colors.primary}`、深色态随 seed（本产品品牌色与文本色同值），
//   文件内不得出现任何字面色值（`design-discipline.test.ts` 的 `hardcoded-color` 守卫覆盖）。
// - **尺寸随字号类**（行内 14 `text-sm` / 16 `text-base`，本卡落点固定 16）；**不做 Filled 变体**。
// - 落点两处、同款：左栏顶部标识（`[标记] 书架`，`#/` 入口）与 `info-bar` 项目名左侧（`[标记] 书名`）。
// 几何定于 64 视图网格（`viewBox="0 0 64 64"`），显示尺寸由 width/height 缩放。
import { cn } from "../../lib/utils";

export interface AppMarkProps {
  /** 上下文附加类（外边距 / 对齐由调用点给；`shrink-0` 已默认内置） */
  className?: string;
}

/** 界内品牌标记（描边态）：左栏顶部标识与 `info-bar` 项目名左侧两处同款 */
export function AppMark({ className }: AppMarkProps) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M12 10 V54" strokeWidth={7} />
        <path d="M26 18 H55" strokeWidth={6} />
        <path d="M26 32 H44" strokeWidth={6} />
        <path d="M26 46 H35" strokeWidth={6} />
      </g>
    </svg>
  );
}
