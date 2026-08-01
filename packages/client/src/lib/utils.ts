// cn()：类名合并辅助（shadcn/ui 约定，components/ui 下组件共用）
// 最小实现：过滤假值后拼接；不引入 clsx / tailwind-merge（避免多余依赖，后续有冲突类合并需求再加）
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
