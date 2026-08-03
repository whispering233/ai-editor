// 页面级 tab 化分段面包屑（任务卡 U7：实体详情页返回入口；通用组件，可复用于其他页面）
// 设计：分段 pill 视觉——有 href 的段可点击返回上级（hover 反馈），无 href 的段为当前位置
//   （高亮不可点）；段间以「›」分隔，层级一目了然。点击统一走 navigate（自制 hash 路由，
//   与 EntityList 列表 tab 一致）。
// 样式红线（layout.md §3，token 类，禁止硬编码色类）：
//   激活段 bg-foreground/text-background（反相高对比，对应列表页类型 tab bg-zinc-900/text-white 观感），
//   未激活段 text-muted-foreground + hover:bg-muted/hover:text-foreground（对应列表 tab 未激活态）。
import { cn } from "@/lib/utils";
import { navigate } from "../../hooks/use-route";

/** 面包屑段：label 显示文案；href 目标路径（无 href = 当前位置，高亮不可点） */
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** tab 化分段面包屑：`实体 › 人物 › 张三`——最后一段（无 href）为当前位置，中间段点击返回上级 */
export function Breadcrumb({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav aria-label="面包屑" className={cn("inline-flex items-center gap-1", className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {item.href ? (
              <button
                type="button"
                onClick={() => navigate(item.href!)}
                className="rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </button>
            ) : (
              <span
                aria-current="page"
                className="max-w-40 truncate rounded-md bg-foreground px-2.5 py-1 text-sm font-medium text-background"
              >
                {item.label}
              </span>
            )}
            {!isLast && <span className="select-none text-sm text-muted-foreground/40">›</span>}
          </span>
        );
      })}
    </nav>
  );
}
