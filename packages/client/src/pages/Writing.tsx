// 写作页（2026-11）：路由 `#/writing`（无选中章）/ `#/writing/:chapterId`（章正文）。
// 契约：docs/ui/DESIGN.md `writing-page`。本页 = 中栏 master-detail 的壳：卷章导航栏（rail）与正文列。
// **本卡只落导航 / 路由 / 页面壳**——rail（卷章导航栏）、最近导航、宽度拖拽由后续卡接线，故此页当前
// 只有正文列独占宽度（无 id 时也不渲染空白 rail 占位）。
//
// 大纲只在这里加载一次（`GET /outline?with_metadata=true`，rail 行徽标 / 字数要用统计）；
// 章正文的一切（加载 / 自动保存 / 冲突 / 导入导出 / 专注 / 页头 / 工具条）都在
// `components/manuscript/chapter-editor.tsx`，页面不重复一套。换章只重挂编辑器子树——
// 页面本身不挂 key（否则换章会把 rail 一起重挂）。
import { Button } from "antd";
import { ChapterEditor } from "../components/manuscript/chapter-editor";
import { EmptyState } from "../components/ui/empty-state";
import { PageHeader } from "../components/ui/page-header";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { useProjectStore } from "../stores/project";

export default function Writing({ chapterId }: { chapterId?: string }) {
  const outline = useProjectStore((s) => s.outline);
  // 大纲按页加载（页壳持有加载生命周期；编辑器面板不自行拉树）
  useOutlineLoader({ withMetadata: true });

  return (
    // -m-6 / h-[calc(100%+3rem)]：抵消中栏内容区的 p-6（同人物工作台的写作页外壳，见
    // DESIGN.md §Layout「写作页的中栏内分栏」）。本卡只有正文列（吸收全部宽度）。
    <section className="-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-6">
        {chapterId !== undefined ? (
          <ChapterEditor
            key={chapterId}
            outline={outline}
            chapterId={chapterId}
            basePath="/writing"
          />
        ) : (
          // 无选中章：页头常驻模板（section 全高 + 内容进内层可滚容器，见 DESIGN.md §Layout）
          <div className="flex h-full min-h-0 flex-col">
            <PageHeader title="写作" />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <EmptyState action={<Button href="#/outline">去大纲</Button>}>
                从大纲选择一章开始写作
              </EmptyState>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}