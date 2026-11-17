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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "antd";
import { ArrowLeftOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { ChapterEditor } from "../components/manuscript/chapter-editor";
import { ChapterRail } from "../components/writing/chapter-rail";
import { EmptyState } from "../components/ui/empty-state";
import { PanelHeader } from "../components/ui/panel-header";
import { ResizeHandle } from "../components/ui/resize-handle";
import { useMediaQuery } from "../hooks/use-media-query";
import { useOutlineLoader } from "../hooks/use-outline-loader";
import { useWritingRail } from "../hooks/use-writing-rail";
import { errorBannerClass, skeletonClass } from "../lib/styles";
import { cn } from "../lib/utils";
import { buildWritingRailRows, readLastOpenedChapter, resolveWritingTarget, writeLastOpenedChapter } from "../lib/writing";
import { useProjectStore } from "../stores/project";
import { useUiStore } from "../stores/ui";

export default function Writing({ chapterId }: { chapterId?: string }) {
  const outline = useProjectStore((s) => s.outline);
  const outlineError = useProjectStore((s) => s.outlineError);
  const config = useProjectStore((s) => s.config);
  const configLoading = useProjectStore((s) => s.configLoading);
  const patchChapterMetadata = useProjectStore((s) => s.patchChapterMetadata);
  const projectId = config?.id ?? null;
  // 大纲按页加载（页壳持有加载生命周期；编辑器面板不自行拉树）
  const { retry } = useOutlineLoader({ withMetadata: true });
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const focusMode = useUiStore((s) => s.focusMode);
  // 卷章导航栏宽度 / 收起态（全局一份，localStorage；拖动只改内存，pointerup 一次写）
  const {
    layout: railLayout,
    resizing,
    startResize,
    moveResize,
    endResize,
    toggleCollapse: toggleRailCollapse,
    toggleDetail: toggleRailDetail,
  } = useWritingRail(isDesktop);

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

  // ============ 最近导航（`#/writing` 无 id 且桌面）============
  // 目标**同步计算**（SSR 不跑 effect）：最近打开（localStorage per-book）仍在可见大纲则用它，
  // 否则回退服务端最近编辑（`metadata.documentUpdatedAt` 最大）；两者皆无 → 空态（不跳第一章）。
  // `current_position` 是阅读进度，绝不复用。
  const lastOpenedId = readLastOpenedChapter(projectId);
  const writingTarget =
    chapterId !== undefined || !isDesktop || configLoading
      ? null
      : resolveWritingTarget(outline, lastOpenedId);
  // 目标未定（大纲未就绪 / 配置加载中 / 待 replace）→ 正文列骨架，不闪空态
  const targetPending = outline === null || configLoading || writingTarget !== null;

  // `#/writing/:id` 命中可见章时记下最近打开（**窄屏也写**；invalid id / 无项目不写）
  useEffect(() => {
    if (chapterId === undefined || !chapterExists || projectId === null) return;
    writeLastOpenedChapter(projectId, chapterId);
  }, [chapterId, chapterExists, projectId]);

  // 有目标 → `location.replace`（replace 不入历史，避免「写作 ↔ 大纲」后退打转；
  // `navigate` 是 push 不能用）。以「当前 hash 是否已是目标」作幂等守卫：StrictMode 第二次
  // effect 自然跳过；从 `#/writing/:id` 再点「写作」回到无 id 形时也能重新解析（不能用一次性 ref，
  // 否则同一实例里第二次进入会永久停在骨架）。窄屏不自动跳。
  useEffect(() => {
    if (chapterId !== undefined || !isDesktop || writingTarget === null) return;
    const targetHash = `#/writing/${writingTarget}`;
    if (window.location.hash === targetHash) return;
    window.location.replace(targetHash);
  }, [chapterId, isDesktop, writingTarget]);

  // rail：桌面展开态有；窄屏只在无 id（目录页）时有；桌面收起态 = 0px（不渲染 rail，正文列吸收宽度）。
  // 专注模式两者都不渲染。
  const railCollapsed = isDesktop && railLayout.collapsed;
  // 右侧详情（正文列）收起（桌面态才生效）：正文列整列不渲染、rail 吸收全宽。
  // rail 收起时正文列必须留着（两档收起各靠对侧那一栏的按钮，rail 不在时正文列保留）；
  // 专注模式无 rail / 页头，正文列不被该偏好隐藏。
  const detailHidden = isDesktop && !focusMode && !railCollapsed && railLayout.detailCollapsed;
  const rail =
    !focusMode && (isDesktop || chapterId === undefined) && !railCollapsed ? (
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
        // 右侧详情收起 = rail 吸收全宽（不写 layout.width）；窄屏全宽同此口径
        width={isDesktop && !detailHidden ? railLayout.width : undefined}
        // 无邻栏时抹掉 rail 自带的右边线（DESIGN.md §Layout「分栏边线单所有权」）；
        // 右侧详情收起时邻栏不在，同窄屏
        className={isDesktop && !detailHidden ? undefined : "w-full border-r-0"}
        // 详情收起按钮只在桌面态传给 rail（窄屏无相邻正文列）
        detailCollapsed={isDesktop ? railLayout.detailCollapsed : undefined}
        onToggleDetail={isDesktop ? toggleRailDetail : undefined}
      />
    ) : null;

  // 卷章导航栏收起 / 展开入口：正文列页头标题行最左（`PanelHeader` `leading`；DESIGN.md `writing-page`
  // 「宽度与收起」）。同一枚按钮进四种正文形态；窄屏（无子栏）与专注模式（页头不渲染）都不渲染。
  // 图标 = 当前点击动作（展开态收起 / 收起态展开）；状态由动态 `aria-label` / `title` / `aria-expanded` 表达。
  const railToggle =
    isDesktop && !focusMode ? (
      <Button
        color="default" variant="text"
        size="small"
        onClick={toggleRailCollapse}
        icon={
          railCollapsed ? (
            <RightOutlined className="text-sm" />
          ) : (
            <LeftOutlined className="text-sm" />
          )
        }
        aria-label={railCollapsed ? "展开卷章导航栏" : "收起卷章导航栏"}
        title={railCollapsed ? "展开卷章导航栏" : "收起卷章导航栏"}
        aria-expanded={!railCollapsed}
      />
    ) : undefined;

  const outlineFailureBanner = (
    <div className={cn(errorBannerClass, "flex shrink-0 items-center gap-3")}>
      <span className="min-w-0 flex-1">大纲加载失败，章节目录暂不可用</span>
      <Button size="small" onClick={retry}>
        重试
      </Button>
    </div>
  );

  let bodyContent: ReactNode = null;
  // 正文列骨架（大纲未就绪 / 目标解析中；写作页与编辑面板共用同一形状）
  const bodySkeleton = (
    <div className="space-y-2 rounded-md border border-border p-3">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={cn(skeletonClass, "h-5")}
          style={{ width: `${92 - i * 12}%` }}
        />
      ))}
    </div>
  );
  if (chapterId !== undefined) {
    if (outline === null) {
      // 大纲未就绪：先给正文骨架，**不先挂 ChapterEditor**——否则坏 chapterId 会先发一次
      // GET /manuscript/:id（404 落 console），等大纲到达才发现章不存在。
      bodyContent = (
        <section className="flex min-h-0 flex-1 flex-col">
          <PanelHeader
            title="写作"
            leading={railToggle}
            className="mb-4 -mx-6"
            insetClassName="px-6"
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {outlineFailed ? (
              outlineFailureBanner
            ) : (
              bodySkeleton
            )}
          </div>
        </section>
      );
    } else if (!chapterExists) {
      // 显式坏 chapterId：不自动回退（最近导航失效由 writing-3 的解析阶段处理）
      bodyContent = (
        <section className="flex min-h-0 flex-1 flex-col">
          <PanelHeader
            title="写作"
            leading={railToggle}
            className="mb-4 -mx-6"
            insetClassName="px-6"
          />
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
            headerLeading={railToggle}
            onSaved={({ charCount, updatedAt }) =>
              patchChapterMetadata(chapterId, { textLength: charCount, documentUpdatedAt: updatedAt })
            }
          />
        </div>
      );
    }
  } else if (isDesktop) {
    bodyContent = (
      <section className="flex min-h-0 flex-1 flex-col">
        <PanelHeader
          title="写作"
          leading={railToggle}
          className="mb-4 -mx-6"
          insetClassName="px-6"
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {outline === null ? (
            outlineFailed ? outlineFailureBanner : bodySkeleton
          ) : targetPending ? (
            bodySkeleton
          ) : !hasChapterRows ? (
            <EmptyState action={<Button href="#/outline">去大纲新建第一卷</Button>}>
              还没有章节
            </EmptyState>
          ) : (
            <p className="text-sm text-muted-foreground">
              {railCollapsed
                ? "从页头左侧展开卷章导航栏，选择一章开始写作"
                : "从左侧选择一章开始写作"}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    // -m-6 / h-[calc(100%+3rem)]：抵消中栏内容区的 p-6（同人物工作台的写作页外壳，见
    // DESIGN.md §Layout「写作页的中栏内分栏」）。正文列内补回同一内边距。
    // 拖拽期间根容器禁文本选中（指针已 capture 在手柄上，兜底防边缘选中）。
    <section
      className={cn(
        "-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden",
        resizing && "select-none",
      )}
    >
      {rail}
      {/* 桌面展开态右边界 6px 拖拽手柄；收起态 / 右侧详情收起（rail 全宽）不渲染 */}
      {!focusMode && isDesktop && !railCollapsed && !detailHidden && (
        <ResizeHandle
          label="调整卷章导航栏宽度"
          active={resizing}
          onStart={startResize}
          onMove={moveResize}
          onEnd={endResize}
        />
      )}
      {/* 桌面端 `pt-0`：页头 `-mx-6` 穿透列内边距后分割线全幅（DESIGN.md §Layout「工作台子栏页头」）；
          窄屏保留 p-6（返回条与内边距不变）。右侧详情收起时正文列（含 bodyContent）整列不渲染
          （自动保存生命周期在编辑器自身，不在此改；宽度保留在存储里，展开恢复原宽）。 */}
      {bodyContent !== null && !detailHidden && (
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col p-6", isDesktop && "pt-0")}>
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
