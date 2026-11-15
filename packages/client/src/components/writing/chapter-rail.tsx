// 写作页卷章导航栏（2026-11）。契约：docs/ui/DESIGN.md `writing-page`。
//
// **纯 presenter**：行数据由页面经 `lib/writing.ts` 派生，折叠 state 也由页面持有；本组件不发请求、
// 不做结构编辑（无新建 / 改名 / 删除 / 拖拽 / 右键菜单——结构编辑唯一入口仍是大纲树）。
// 宽度 / 收起态由页面持有（hooks/use-writing-rail）：本组件只消费 width / onCollapse；右侧拖拽手柄
// 由页面作为兄弟渲染（不塞进 rail 宽度内，见 DESIGN.md `writing-page`「宽度与收起」）。
//
// 行几何与大纲树同密度：32px 行高、24px 折叠箭头盒、编号徽标 `min-w-14`（对齐口径见 DESIGN.md
// §大纲页「缩进列对齐」）；章行是 `<a href="#/writing/:id">`，点击直接进正文，不渲染「写正文」按钮。
import { useEffect, useRef } from "react";
import { Button, Typography } from "antd";
import { DoubleLeftOutlined, RightOutlined } from "@ant-design/icons";
import { formatTextLength } from "../../lib/manuscript";
import { errorBannerClass, skeletonClass } from "../../lib/styles";
import { cn } from "../../lib/utils";
import type { WritingRailRow } from "../../lib/writing";
import { TypeChip } from "../ui/tag-chip";

export interface ChapterRailProps {
  /** `buildWritingRailRows` 的扁平行（卷行 + 其章行 / 根级章原位） */
  rows: WritingRailRow[];
  /** 当前选中章 id（路由已解析；未选中 = null） */
  selectedId: string | null;
  /** 折叠的卷 id 集合（页面 state，刷新复位、切章不重置） */
  collapsed: Set<string>;
  /** 点击卷行箭头：只折叠 / 展开该卷 */
  onToggleVolume: (volumeId: string) => void;
  /** 大纲加载中 / 失败时保持骨架（不显示「还没有章节」） */
  loading?: boolean;
  /** 窄屏目录页的大纲错误（桌面错误在正文列，rail 保持骨架） */
  error?: string | null;
  onRetry?: () => void;
  /** 覆盖类（窄屏两级导航时全宽且不留右边线：`w-full border-r-0`——`cn` 用 twMerge，同属性后者胜） */
  className?: string;
  /** 展开态宽度（px）；不传 = 不设内联宽（窄屏全宽走 className） */
  width?: number;
  /** 桌面态收起入口；不传 = 不渲染收起按钮（窄屏无收起） */
  onCollapse?: () => void;
}

export function ChapterRail({
  rows,
  selectedId,
  collapsed,
  onToggleVolume,
  loading = false,
  error = null,
  onRetry,
  className,
  width,
  onCollapse,
}: ChapterRailProps) {
  // 换章后把选中行滚进可视区（`nearest`：已在视野内则不跳）。SSR 不跑 effect。
  const selectedRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // 折叠卷只隐其章行；根级章（volumeId = null）恒显示
  const visibleRows = rows.filter(
    (row) => row.kind === "volume" || row.volumeId === null || !collapsed.has(row.volumeId),
  );

  return (
    <aside
      aria-label="卷章导航栏"
      style={width === undefined ? undefined : { width }}
      // 桌面展开态分栏线归本栏；窄屏全宽由页面传 `border-r-0`
      //（DESIGN.md §Layout「分栏边线单所有权」——手柄不画线，只有面板边线能覆盖抽屉 / 窄屏 / 窄条）
      className={cn("flex shrink-0 flex-col border-r border-border", className)}
    >
      {/* header 40px：标题 + 收起按钮（仅桌面态传入 onCollapse） */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Typography.Title level={5} className="min-w-0 flex-1 truncate">
          卷章
        </Typography.Title>
        {onCollapse !== undefined && (
          <Button
            color="default" variant="text"
            size="small"
            className="shrink-0"
            onClick={onCollapse}
            aria-label="收起卷章导航栏"
            title="收起卷章导航栏"
            icon={<DoubleLeftOutlined />}
          />
        )}
      </div>

      {/* 行区：独立纵向滚动；p-2 = 8px */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error !== null ? (
          <div className="space-y-2">
            <p className={errorBannerClass}>{error}</p>
            {onRetry !== undefined && (
              <Button block size="small" onClick={onRetry}>
                重试
              </Button>
            )}
          </div>
        ) : loading ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={cn(skeletonClass, "h-8")} />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">还没有章节</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {visibleRows.map((row) => {
              if (row.kind === "volume") {
                const isCollapsed = collapsed.has(row.id);
                const volumeContent = (
                  <>
                    {row.chapterCount > 0 ? (
                      <span className="-ml-2 flex w-6 shrink-0 items-center justify-center">
                        <RightOutlined
                          className={cn(
                            "text-sm transition-transform",
                            !isCollapsed && "rotate-90",
                          )}
                        />
                      </span>
                    ) : (
                      /* 无子章：与折叠箭头同几何的空占位（不画点了没反应的箭头） */
                      <span className="-ml-2 w-6 shrink-0" aria-hidden />
                    )}
                    <TypeChip className="min-w-14 shrink-0 justify-center tabular-nums">
                      {row.label}
                    </TypeChip>
                    <span className="min-w-0 flex-1 truncate text-sm" title={row.title}>
                      {row.title}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {row.chapterCount}章
                    </span>
                  </>
                );
                return (
                  <li key={row.id}>
                    {row.chapterCount > 0 ? (
                      <button
                        type="button"
                        data-volume-id={row.id}
                        onClick={() => onToggleVolume(row.id)}
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? "展开" : "折叠"}「${row.title}」`}
                        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-foreground transition-colors hover:bg-muted"
                      >
                        {volumeContent}
                      </button>
                    ) : (
                      <div
                        data-volume-id={row.id}
                        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-foreground"
                      >
                        {volumeContent}
                      </div>
                    )}
                  </li>
                );
              }

              const selected = row.id === selectedId;
              const lengthLabel = formatTextLength(row.textLength);
              return (
                <li key={row.id}>
                  <a
                    ref={selected ? selectedRef : undefined}
                    data-chapter-id={row.id}
                    href={`#/writing/${row.id}`}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-foreground transition-colors",
                      selected ? "bg-accent text-foreground" : "hover:bg-muted",
                    )}
                  >
                    {/* 缩进占位：与卷行折叠箭头同几何（24px 盒） */}
                    <span className="-ml-2 w-6 shrink-0" aria-hidden />
                    <TypeChip className="min-w-14 shrink-0 justify-center tabular-nums">
                      {row.label}
                    </TypeChip>
                    <span className="min-w-0 flex-1 truncate text-sm" title={row.title}>
                      {row.title}
                    </span>
                    {lengthLabel !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {lengthLabel}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
