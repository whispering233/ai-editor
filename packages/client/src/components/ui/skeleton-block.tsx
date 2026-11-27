// 卡形加载占位（契约：DESIGN.md §Components `skeleton-block`）
//
// 只承接「区块卡」形状的占位：`EntityDetail` / `TimelineDetail` 的「基础信息 + 关联」两块在加载时
// 用同样的描边卡 + N 行灰条。行内 / 列表 / 文字骨架（`h-4`~`h-20`、带宽度、`bg-muted/60` 的那几十处）
// 形状各异，继续直接用 `lib/styles.ts` 的 `skeletonClass` 拼，**不进本组件**——不参数化成「什么都能配」。
//
// ⚠ 圆角与「它模拟的真实卡」绑死：那 4 处真实卡已是 `SectionCard`（antd Card = `{rounded.md}` 8px）
// ⇒ 本组件也用 8px，加载完成瞬间不跳档。将来换卡的圆角档位，**必须与本组件同卡改**
// （两处不同改的后果是加载完成瞬间圆角跳一档，而且只有肉眼看得到：测试与类型都绿）。
import { cn } from "@/lib/utils";
import { skeletonClass } from "@/lib/styles";

/** 壳串：`design-discipline.test.ts` 的 `skeleton-block-shell` 守卫锁住复制 */
const SHELL_CLASS = "space-y-3 rounded-lg border border-border p-4";

/** 行高档固定 9（= 一行控件高），**不参数化**：换行高就是另一种占位形态，不该走本组件 */
const ROW_CLASS = "h-9";

export interface SkeletonBlockProps {
  /** 占位行数（缺省 3；现网只有 3 与 5 两种） */
  rows?: number;
  /** 附加类（网格占位 / 外边距由调用点给） */
  className?: string;
}

export function SkeletonBlock({ rows = 3, className }: SkeletonBlockProps) {
  return (
    <div className={cn(SHELL_CLASS, className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn(skeletonClass, ROW_CLASS)} />
      ))}
    </div>
  );
}
