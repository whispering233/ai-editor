// 区块卡（layout.md §2.5：rounded-xl border bg-card p-4 + font-serif 标题；action = 标题行右侧操作区）
// 上提自 OutlineDetail 局部 Card（L 批次）：跨页复用，替换 Dashboard 等区块式页面手写 section
// 用法：
//   <SectionCard title="项目信息" action={<Button ...>编辑</Button>}>...</SectionCard>
//   <SectionCard>无标题区块</SectionCard>
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sectionCardClass } from "@/lib/styles";

export interface SectionCardProps {
  /** 区块标题（font-serif text-base；缺省 = 无标题行） */
  title?: ReactNode;
  /** 标题行右侧操作区 */
  action?: ReactNode;
  /** 覆盖类（如 lg:col-span-2 网格占位） */
  className?: string;
  children: ReactNode;
}

/** 区块卡：容器 + 可选标题行（font-serif）+ 内容区 */
export function SectionCard({ title, action, className, children }: SectionCardProps) {
  return (
    <div className={cn(sectionCardClass, className)}>
      {title !== undefined && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-serif text-base">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
