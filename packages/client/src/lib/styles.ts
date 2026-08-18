/**
 * 共享样式常量（layout.md §4.4「样式书写规范」L 批次）
 *
 * 规则（新增常量时遵守）：
 * - 仅提取重复 ≥3 处的纯样式字符串；短类（≤4 个 token）不提取
 * - 常量只含「稳定不变」的类；易变属性（宽度/间距/圆角等）由调用点决定——
 *   ⚠ Tailwind 4 同属性类按值排序、CSS 中后者胜（实测 py-12 排在 py-10 后并压掉它），
 *   常量含有的类，调用点无法用「排序更早」的类覆盖（layout.md §4.3 对话框 max-w 同款坑）
 * - 只允许 token 类（bg-card / text-muted-foreground 等），禁止硬编码色类（zinc/white 等）
 */

/** 图标按钮基座（layout.md §4.3：图标按钮不受 H4 边框约束；尺寸见 iconButtonSize，禁用见 iconButtonDisabledClass） */
export const iconButtonBaseClass =
  "flex shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/** 图标按钮尺寸：bar = 侧栏行内窄按钮（h-8 w-6）；sm = 默认（size-7）；md = 大号（size-8） */
export const iconButtonSize = {
  bar: "h-8 w-6",
  sm: "size-7",
  md: "size-8",
} as const;
export type IconButtonSize = keyof typeof iconButtonSize;

/** 图标按钮禁用态（追加在 iconButtonBaseClass 之后） */
export const iconButtonDisabledClass = "disabled:pointer-events-none disabled:opacity-50";

/** 裸输入框（列表内联编辑 / 筛选等非 shadcn Input 场景）；⚠ 不含宽度类——w-full / w-40 由调用点决定（w-40 排序在 w-full 前，常量含 w-full 会压掉它） */
export const inputClass =
  "rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** 错误横幅容器（layout.md §4.3：bg-destructive/10 border-destructive/30 text-destructive）；间距/布局（mb-3 / flex 等）由调用点追加 */
export const errorBannerClass =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive";

/** 骨架占位（layout.md §4.3：区块级 animate-pulse bg-muted）；⚠ radius 可覆盖——rounded-lg / rounded-md 排序在 rounded 之后 */
export const skeletonClass = "animate-pulse rounded bg-muted";

/** 区块卡容器（layout.md §2.5：rounded-xl border bg-card p-4；标题/内容见 SectionCard 组件） */
export const sectionCardClass = "rounded-xl border border-border bg-card p-4";
