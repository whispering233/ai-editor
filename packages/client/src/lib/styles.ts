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

/** 错误横幅容器（：bg-destructive/10 border-destructive/30 text-destructive）；间距/布局（mb-3 / flex 等）由调用点追加 */
export const errorBannerClass =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive";

/** 骨架占位（：区块级 animate-pulse bg-muted）；⚠ radius 可覆盖——rounded-lg / rounded-md 排序在 rounded 之后 */
export const skeletonClass = "animate-pulse rounded bg-muted";
