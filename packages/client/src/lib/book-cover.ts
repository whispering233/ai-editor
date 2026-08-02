// 书架封面占位色相派生（S1.6）：书名 → 0-360 色相，同书同色、稳定可测
// 设计依据：doc/ui/pages/dashboard.md「封面占位：渐变底色块 + 书名首字，色相由书名 hash 稳定派生
//   （同书同色、稳定），无任何数据依赖」——纯前端派生，不需要后端提供封面图字段
// 实现：djb2 字符串 hash → 无符号 32 位 → 对 360 取模（JS 取模对负数结果可能为负，先 >>> 0 归正）
import type { CSSProperties } from "react";

/**
 * 书名 → 封面占位色相（0-360，闭区间内整数）
 * 同名返回同值；空串返回 0（不抛错，边界兜底——UI 层书名非空）
 */
export function bookCoverHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    // 31 倍变体：(hash << 5) - hash = 32h - h = 31h，即 hash * 31 + char（非标准 djb2 的 33 倍）；
    // >>> 0 保持无符号 32 位（避免溢出后取模出负数）
    hash = ((hash << 5) - hash + name.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** 封面占位 CSS：135° 渐变底（浅色纸感）+ 深色首字；色相运行时派生，故用内联 style 而非 Tailwind 类 */
export function bookCoverStyle(hue: number): CSSProperties {
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 45% 90%), hsl(${hue} 55% 76%))`,
    color: `hsl(${hue} 55% 28%)`,
  };
}
