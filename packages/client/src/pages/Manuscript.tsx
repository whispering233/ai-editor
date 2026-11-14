// 章正文页（卡 12.5）：路由 #/manuscript/:chapterId。写正文入口已改指写作页 `#/writing/:chapterId`，
// 本页仅保留旧书签可用；页面本身只是薄壳：负责大纲树的按页加载，正文的一切
// （加载 / 自动保存 / 冲突 / 导入导出 / 专注 / 页头 / 工具条 / 字数与保存态）都在
// `components/manuscript/chapter-editor.tsx`。契约：docs/api/110-api-manuscript.md、
// docs/ui/DESIGN.md §Layout「页头常驻」；设计语义见 design/10-data-model.md §13。
//
// 大纲树（标题 + 上下章）：本页不展示章字数，故不需要联表统计（withMetadata: false）。
// 换章由路由层换 key 重挂本页；这里再按 chapterId 挂 `ChapterEditor` 的 key，保证面板随章重置。
import { ChapterEditor } from "../components/manuscript/chapter-editor";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { useProjectStore } from "../stores/project";

export default function Manuscript({ chapterId }: { chapterId: string }) {
  const outline = useProjectStore((s) => s.outline);
  // 大纲按页加载（壳持有加载生命周期）；编辑器只消费传入的树
  useOutlineLoader({ withMetadata: false });

  return (
    <ChapterEditor
      key={chapterId}
      outline={outline}
      chapterId={chapterId}
      basePath="/manuscript"
    />
  );
}