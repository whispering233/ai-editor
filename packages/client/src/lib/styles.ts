/**
 * 共享样式常量（「样式书写规范」L 批次）
 *
 * 规则（新增常量时遵守）：
 * - 仅提取重复 ≥3 处的纯样式字符串；短类（≤4 个 token）不提取
 * - 常量只含「稳定不变」的类；易变属性（宽度/间距/圆角等）由调用点决定——
 * ⚠ Tailwind 4 同属性类按值排序、CSS 中后者胜（实测 py-12 排在 py-10 后并压掉它），
 * 常量含有的类，调用点无法用「排序更早」的类覆盖（ 对话框 max-w 同款坑）
 * - 只允许 token 类（bg-card / text-muted-foreground 等），禁止硬编码色类（zinc/white 等）
 */

/** 图标按钮基座（：图标按钮不受 H4 边框约束；尺寸见 iconButtonSize，禁用见 iconButtonDisabledClass） */
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

/** 原生 `select` 统一样式（批次十九 T6：文本输入已收敛 antd `Input`，原生下拉保留待后续卡）；
 * 白底 + 交互描边 + 聚焦 1px primary 描边（无彩环）——对齐 DESIGN.md §Components `input`
 * （`bg-card` = canvas；`border-input` = hairline-strong，与相邻 antd `Input` 描边同档，见 index.css 变量映射）；
 * ⚠ 不含宽度类——w-full / w-40 由调用点决定（w-40 排序在 w-full 前，常量含 w-full 会压掉它） */
export const selectClass =
  "rounded-md border border-input bg-card px-3 py-1.5 text-sm focus:outline-none focus-visible:border-ring";

/** 错误横幅容器（：bg-destructive/10 border-destructive/30 text-destructive）；间距/布局（mb-3 / flex 等）由调用点追加 */
export const errorBannerClass =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive";

/** 骨架占位（：区块级 animate-pulse bg-muted）；⚠ radius 可覆盖——rounded-lg / rounded-md 排序在 rounded 之后 */
export const skeletonClass = "animate-pulse rounded bg-muted";
