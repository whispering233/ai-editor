// 区块卡（antd Card 1px hairline 描边 + 8px 圆角 + 16px 内边距；action = 标题行右侧操作区）
// 上提自 OutlineDetail 局部 Card：跨页复用，替换 Dashboard 等区块式页面手写 section
// 用法：
// <SectionCard title="项目信息" action={<Button ...>编辑</Button>}>...</SectionCard>
// <SectionCard>无标题区块</SectionCard>
import type { ReactNode } from "react";
import { Card, Typography } from "antd";

export interface SectionCardProps {
  /** 区块标题（Typography.Title level={5} = 16px/600；缺省 = 无标题行） */
  title?: ReactNode;
  /** 标题行右侧操作区 */
  action?: ReactNode;
  /** 覆盖类（如 lg:col-span-2 网格占位） */
  className?: string;
  children: ReactNode;
}

/** 区块卡：antd Card 容器（内边距走 Card.bodyPadding token，不用自带表头）+ 可选标题行 + 内容区 */
export function SectionCard({ title, action, className, children }: SectionCardProps) {
  return (
    <Card className={className}>
      {title !== undefined && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <Typography.Title level={5}>{title}</Typography.Title>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}
