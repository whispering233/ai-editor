// 写作页（2026-11）：路由 `#/writing`（无选中章）/ `#/writing/:chapterId`（章正文）。
// 契约：docs/ui/DESIGN.md `writing-page` + §Layout「写作页的中栏内分栏」「页头常驻」。
// 本页 = 中栏 master-detail 的壳：卷章导航栏（rail）与正文列。
//
// 大纲只在这里加载一次（`GET /outline?with_metadata=true`，rail 行徽标 / 字数要用统计）；
// 章正文的一切（加载 / 自动保存 / 冲突 / 导入导出 / 专注 / 页头 / 工具条）都在
// `components/manuscript/chapter-editor.tsx`，页面不重复一套。换章只重挂编辑器子树——
// 页面本身不挂 key（否则换章会把 rail 一起重挂）。
//
// 响应式（<1024px）= 两级互斥（同人物工作台）：`#/writing` 只显示 rail 全宽（无正文）；
// `#/writing/:id` 只显示正文全宽 + 顶部「章节目录」返回条。专注模式隐藏 rail 与返回条。
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { ChapterEditor } from "../components/manuscript/chapter-editor";
import { ChapterRail } from "../components/writing/chapter-rail";
import { EmptyState } from "../components/ui/empty-state";
import { PageHeader } from "../components/ui/page-header";
import { useMediaQuery } from "../hooks/use-media-query";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { cn } from "../lib/utils";
import { buildWritingRailRows } from "../lib/writing";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

export default function Writing({ chapterId }: { chapterId?: string }) {
  const outline = useProjectStore((s) => s.outline);
  const outlineError = useProjectStore((s) => s.outlineError);
  // 大纲按页加载（页壳持有加载生命周期；编辑器面板不自行拉树）
  const { retry } = useOutlineLoader({ withMetadata: true });
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const focusMode = useUiStore((s) => s.focusMode);

  // 卷折叠 state = 页面 state（session；不写 localStorage，刷新复位、切章不重置）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleVolume = useCallback((volumeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(volumeId)) next.delete(volumeId);
      else next.add(volumeId);
      return next;
    });
  }, []);

  const rows = useMemo(() => buildWritingRailRows(outline), [outline]);
  // 卷行恒存在（0 章卷也保留）⇒ 判断「有没有章」必须看章行，不能看 rows.length。
  const hasChapterRows = rows.some((row) => row.kind === "chapter");
  const chapterExists =
    chapterId !== undefined &&
    rows.some((row) => row.kind === "chapter" && row.id === chapterId);
  // 大纲加载失败（以 store 的错误标记为准：首帧 / 加载中 outlineError 为 null，不误报失败）。
  // 错误提示在正文列（桌面）；窄屏目录页没有正文列，错误与重试挂在 rail 内。
  const outlineFailed = outline === null && outlineError !== null;

  // rail：桌面恒有；窄屏只在无 id（目录页）时有。专注模式两者都不渲染。
  const rail =
    !focusMode && (isDesktop || chapterId === undefined) ? (
      <ChapterRail
        rows={rows}
        selectedId={chapterId ?? null}
        collapsed={collapsed}
        onToggleVolume={toggleVolume}
        // 大纲加载中 / 失败都保持骨架（错误提示在正文列；rail 不自己发请求）；
        // 窄屏目录页没有正文列，错误与重试改挂在 rail 内。
        loading={outline === null}
        error={!isDesktop && outlineFailed ? "大纲加载失败，章节目录暂不可用" : null}
        onRetry={retry}
        className={isDesktop ? undefined : "w-full border-r-0"}
      />
    ) : null;

  const outlineFailureBanner = (
    <div className={cn(errorBannerClass, "flex shrink-0 items-center gap-3")}>
      <span className="min-w-0 flex-1">大纲加载失败，章节目录暂不可用</span>
      <Button size="small" onClick={retry}>
        重试
      </Button>
    </div>
  );

  let bodyContent: ReactNode = null;
  if (chapterId !== undefined) {
    if (outline === null) {
      // 大纲未就绪：先给正文骨架，**不先挂 ChapterEditor**——否则坏 chapterId 会先发一次
      // GET /manuscript/:id（404 落 console），等大纲到达才发现章不存在。
      bodyContent = (
        <section className="flex min-h-0 flex-1 flex-col">
          <PageHeader title="写作" />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {outlineFailed ? (
              outlineFailureBanner
            ) : (
              <div className="space-y-2 rounded-md border border-border p-3">
                {Array.from({ length: 5 }, (_, i) => (
                  <div
                    key={i}
                    className={cn(skeletonClass, "h-5")}
                    style={{ width: `${92 - i * 12}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      );
    } else if (!chapterExists) {
      // 显式坏 chapterId：不自动回退（最近导航失效由 writing-3 的解析阶段处理）
      bodyContent = (
        <section className="flex min-h-0 flex-1 flex-col">
          <PageHeader title="写作" />
          <div className={cn(errorBannerClass, "flex items-center gap-3")}>
            <span className="min-w-0 flex-1">章节不存在或已删除</span>
            <Button href="#/writing">返回章节目录</Button>
          </div>
        </section>
      );
    } else {
      bodyContent = (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChapterEditor
            key={chapterId}
            outline={outline}
            chapterId={chapterId}
            basePath="/writing"
          />
        </div>
      );
    }
  } else if (isDesktop) {
    bodyContent = (
      <section className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="写作" />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {outline === null ? (
            outlineFailed && outlineFailureBanner
          ) : !hasChapterRows ? (
            <EmptyState action={<Button href="#/outline">去大纲新建第一卷</Button>}>
              还没有章节
            </EmptyState>
          ) : (
            <p className="text-sm text-muted-foreground">从左侧选择一章开始写作</p>
          )}
        </div>
      </section>
    );
  }

  return (
    // -m-6 / h-[calc(100%+3rem)]：抵消中栏内容区的 p-6（同人物工作台的写作页外壳，见
    // DESIGN.md §Layout「写作页的中栏内分栏」）。正文列内补回同一内边距。
    <section className="-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden">
      {rail}
      {bodyContent !== null && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-6">
          {/* 窄屏「章节目录」返回条（32px，滚动区之外；专注模式不渲染） */}
          {!isDesktop && chapterId !== undefined && !focusMode && (
            <a
              href="#/writing"
              className="flex h-8 shrink-0 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftOutlined className="text-xs" />
              章节目录
            </a>
          )}
          {bodyContent}
        </div>
      )}
    </section>
  );
}
