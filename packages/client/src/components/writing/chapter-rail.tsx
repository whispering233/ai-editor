// 写作页卷章导航栏（2026-11）。契约：docs/ui/DESIGN.md `writing-page`。
//
// **纯 presenter**：行数据由页面经 `lib/writing.ts` 派生，折叠 state 也由页面持有；本组件不发请求、
// 不做结构编辑（无新建 / 改名 / 删除 / 拖拽 / 右键菜单——结构编辑唯一入口仍是大纲树）。
// 宽度 / 收起态由页面持有（hooks/use-writing-rail）：本组件只消费 width；右侧拖拽手柄由页面作为
// 兄弟渲染（不塞进 rail 宽度内）。面板开关外端锚定（DESIGN.md §Layout「工作台子栏页头」）：
// 左钮走 `leading`（详情列可见时 = 最左可见列）、右钮走 `onToggleDetail`（详情收起时 = 最右可见列）；
// 左栏收起时页面不渲染本栏，左钮改由正文列页头承载、右钮隐藏。
//
// 行几何与大纲树同密度：32px 行高、24px 折叠箭头盒、编号徽标 `min-w-14`（对齐口径见 DESIGN.md
// §大纲页「缩进列对齐」）；章行是 `<a href="#/writing/:id">`，点击直接进正文，不渲染「写正文」按钮。
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { Button } from "antd";
import { RightOutlined } from "@ant-design/icons";
import type { ExpectedHookItem } from "../../lib/api";
import { entityDetailPath } from "../../lib/entity-paths";
import { HOOK_STATUS_LABEL } from "../../lib/entity-list";
import { formatTextLength } from "../../lib/manuscript";
import { errorBannerClass, skeletonClass } from "../../lib/styles";
import { cn } from "../../lib/utils";
import type { WritingRailRow } from "../../lib/writing";
import { PanelHeader } from "../ui/panel-header";
import { PanelToggleButton } from "../ui/panel-toggle-button";
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
  /** 展开态宽度（px）；不传 = 不设内联宽（窄屏 / 右侧详情收起时全宽走 className） */
  width?: number;
  /** 标题行最左的面板开关（详情列可见时 = 左钮；两页同一枚，见页面分发） */
  leading?: ReactNode;
  /** 右侧详情当前是否收起（只驱动 header 按钮 / 无障碍状态；正文列由页面决定是否渲染） */
  detailCollapsed?: boolean;
  /** 切换右侧详情收起态；不传 = 不渲染该按钮（详情展开时右钮在正文页头、窄屏无相邻正文列） */
  onToggleDetail?: () => void;
  /** 当前章「待回收」伏笔（页面拉取；空数组 = 整块不渲染） */
  expectedHooks?: ExpectedHookItem[];
  /** 「本章待回收」折叠态（页面 state，同卷折叠口径：不写 localStorage） */
  expectedCollapsed?: boolean;
  onToggleExpected?: () => void;
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
  leading,
  detailCollapsed,
  onToggleDetail,
  expectedHooks = [],
  expectedCollapsed = false,
  onToggleExpected,
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
      //（DESIGN.md §Layout「分栏边线单所有权」——手柄不画线，只有面板边线能覆盖抽屉 / 窄屏 / 收起）
      className={cn("flex shrink-0 flex-col border-r border-border", className)}
    >
      {/* 子栏页头（40 + 24 + 分割线）。`mb-0`：行区紧随分割线（DESIGN.md §Layout
          「工作台子栏页头」内容起点口径）；承载面板开关时横向内距用 `px-6`（加在两行包装上，
          分割线仍全幅），无开关时保持默认 `px-3`。
          左钮 = 详情列可见时的 `leading`；右钮 = 详情收起时的右端组（最右端，紧邻被收起的正文列）。 */}
      <PanelHeader
        title="卷章"
        leading={leading}
        className="mb-0"
        insetClassName={leading !== undefined || onToggleDetail !== undefined ? "px-6" : undefined}
        actions={
          onToggleDetail === undefined ? undefined : (
            <PanelToggleButton
              side="right"
              collapsed={detailCollapsed ?? false}
              label="右侧详情"
              onToggle={onToggleDetail}
            />
          )
        }
      />

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
                <Fragment key={row.id}>
                  <li>
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
                      <TypeChip
                        tone="soft"
                        className="min-w-14 shrink-0 justify-center tabular-nums"
                      >
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
                  {/* 「本章待回收 · N」紧跟在当前章行之后（不是 rail 尾部）；无命中整块不渲染 */}
                  {selected && onToggleExpected !== undefined && expectedHooks.length > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={onToggleExpected}
                        aria-expanded={!expectedCollapsed}
                        className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-muted-foreground transition-colors hover:bg-muted"
                      >
                        <span className="-ml-2 flex w-6 shrink-0 items-center justify-center">
                          <RightOutlined
                            className={cn(
                              "text-sm transition-transform",
                              !expectedCollapsed && "rotate-90",
                            )}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs">
                          本章待回收 · {expectedHooks.length}
                        </span>
                      </button>
                      {!expectedCollapsed && (
                        <ul className="space-y-0.5">
                          {expectedHooks.map((hook) => (
                            <li key={hook.id}>
                              <a
                                href={`#${entityDetailPath("hook", hook.id)}`}
                                data-expected-hook-id={hook.id}
                                className="flex h-7 items-center gap-2 rounded-sm py-0 pl-8 pr-2 text-foreground transition-colors hover:bg-muted"
                              >
                                <span
                                  className="min-w-0 flex-1 truncate text-sm"
                                  title={hook.name}
                                >
                                  {hook.name}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {HOOK_STATUS_LABEL[hook.status] ?? hook.status}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
