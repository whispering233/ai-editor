// 文风练习列表页（`#/practice`）——**占位壳**：只有页头常驻模板 + 空态文案。
//
// 卡 9 会把这里替换成真正的列表页（目标分组 + 样本行 + 新建目标/新建样本弹窗），卡 10 补练习页
//（`#/practice/:sampleId`）。本壳**不调任何练习业务端点**（`/practice/*` 的调用归卡 9），只保证：
// 1) 练习工作区的导航有落点（左栏「文风练习」/ 首帧直达都去这里）；
// 2) 页头常驻模板与 DESIGN.md §文风练习区 一致（`section: flex h-full min-h-0 flex-col` +
//    内容进内层可滚容器），卡 9 直接在内层长内容。
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default function Practice() {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <PageHeader title="文风练习" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState padding="sm">还没有练习目标</EmptyState>
      </div>
    </section>
  );
}
