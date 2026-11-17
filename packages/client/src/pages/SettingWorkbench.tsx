// 设定页壳（DESIGN.md `setting-page`，2026-11 改版）：中栏内 master-detail = 左设定树 rail + 右设定详情。
// 两种 hash（`#/setting` / `#/setting/:id`）都渲染本壳，`id` 只决定右列内容（详情 / 空态）——
// rail 的折叠 / 编辑 / 拖拽状态不因选中变化重挂。**选中唯一来源 = URL**：本壳不存选中态，
// 行单击经 rail `onSelect` → 本壳守卫 + `navigate`；刷新 / 深链 / 前进后退都按 URL 收敛。
// 窄屏（<1024px）两级互斥（同大纲页）：`#/setting` 只渲染 rail 全宽，
// `#/setting/:id` 只渲染详情全宽 + 顶部 32px「设定树」返回条（滚动区之外）。
// 数据：rail 自拉 `GET /entities` + `GET /relations`（settings 树）；详情仍走 `EntityDetail` 自己的 GET。
// 本壳只持两个 tick：`reloadKey`（详情保存 onSaved / 数据变更信号 → rail 重拉）与 `useDataRefresh`。
// 未保存守卫：详情上报 dirty，切行 / 清选中 / 窄屏返回条 / 收起右侧详情先 `confirm`
// （浏览器后退仍不拦，见 backlog.md）。
// 两档收起（DESIGN.md `setting-page`「宽度与两档收起」，均存于 hooks/use-setting-rail）：
// 左栏收起 = 不渲染 rail（按钮在详情列页头 `leading`）；右侧详情收起 = 详情列整列不渲染、rail 吸收全宽
// （按钮在 rail header；不改存宽度、不改 URL、点行不自动展开），两栏不会同时收起。
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "antd";
import { ArrowLeftOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { SettingRail } from "../components/entity/setting-rail";
import { PageHeader } from "@/components/ui/page-header";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { EmptyState } from "@/components/ui/empty-state";
import { useMediaQuery } from "../hooks/use-media-query";
import {
  SETTING_RAIL_DEFAULT_WIDTH_CSS,
  useSettingRail,
} from "../hooks/use-setting-rail";
import { useDataRefresh } from "../hooks/use-data-refresh";
import { navigate } from "../hooks/use-route";
import { cn } from "../lib/utils";
import EntityDetail from "./EntityDetail";
import { useUiStore } from "../stores/ui";

/**
 * 设定工作台壳：`id` 与路由一致（undefined = `#/setting` 无选中）。
 * 左列 rail 宽度 / 收起态由 hooks/use-setting-rail 持有（桌面态默认宽度 = SETTING_RAIL_DEFAULT_WIDTH_CSS）；
 * 右列详情页头由 `EntityDetail` 自己渲染，本壳只把「收起 / 展开设定树」按钮作为 `leading` 传下去；
 * 右侧详情的收起 / 展开按钮由本壳传入 rail header（`detailCollapsed` / `onToggleDetail`）。
 */
export default function SettingWorkbench({ id }: { id?: string }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const {
    layout,
    resizing,
    railRef,
    startResize,
    moveResize,
    endResize,
    toggleCollapse,
    toggleDetail,
  } = useSettingRail(isDesktop);
  /** rail 重拉计数（详情保存 / 数据变更信号 → +1；rail 内写操作另有自己的内部 tick） */
  const [tick, setTick] = useState(0);
  // 数据变更信号（AI 提案确认写库 / 工具栏刷新）：壳重拉 rail（收起态也得刷）；详情自己重载
  useDataRefresh(() => setTick((t) => t + 1));
  // 详情表单未保存状态（切行 / 清选中 / 窄屏返回条前 confirm）
  const [detailDirty, setDetailDirty] = useState(false);
  // 切节点（含回 `#/setting`）清零 dirty：新节点尚未编辑
  useEffect(() => setDetailDirty(false), [id]);

  const railCollapsed = isDesktop && layout.collapsed;
  // 右侧详情收起（桌面态才生效）：详情列整列不渲染、rail 吸收全宽。
  // 左栏已收起时详情列必须留着（两档收起各靠对侧那一栏的按钮，rail 不在时置回可见防空白页）。
  const detailHidden = isDesktop && !railCollapsed && layout.detailCollapsed;

  /** 未保存守卫：true = 可以离开（无修改或用户确认放弃）；取消后留在原处、表单不清 */
  async function confirmDiscard(): Promise<boolean> {
    if (!detailDirty) return true;
    return useUiStore.getState().confirm({
      title: "放弃未保存的修改？",
      description: "当前设定的修改尚未保存，切换后将丢失",
    });
  }

  /** 选中切换（rail `onSelect`）：同 id 幂等；dirty 先确认。null = 清选中回 `#/setting` */
  function selectNode(next: string | null) {
    if (next === (id ?? null)) return;
    void confirmDiscard().then((ok) => {
      if (ok) navigate(next === null ? "/setting" : `/setting/${next}`);
    });
  }

  /** 切换右侧详情收起态：收起前过未保存守卫（dirty 才弹，取消不收起）；展开无守卫 */
  function toggleDetailWithGuard() {
    if (layout.detailCollapsed) {
      toggleDetail();
      return;
    }
    void confirmDiscard().then((ok) => {
      if (ok) toggleDetail();
    });
  }

  // 收起 / 展开入口：详情列页头标题行最左（`PageHeader` `leading`，同写作页）；窄屏无相邻栏不渲染
  const railToggle = isDesktop ? (
    <Button
      color="default"
      variant="text"
      size="small"
      onClick={toggleCollapse}
      icon={
        railCollapsed ? (
          <RightOutlined className="text-sm" />
        ) : (
          <LeftOutlined className="text-sm" />
        )
      }
      aria-label={railCollapsed ? "展开设定树" : "收起设定树"}
      title={railCollapsed ? "展开设定树" : "收起设定树"}
      aria-expanded={!railCollapsed}
    />
  ) : undefined;

  // 右列（`#/setting` = 空态；`#/setting/:id` = 详情）：页头恒常驻，内容区独立滚动
  const detail: ReactNode =
    id === undefined ? (
      <section className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="详情" leading={railToggle} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <EmptyState padding="sm">
            {/* 桌面收起态左侧没有栏：引导指向页头左侧的展开钮（同大纲页） */}
            {railCollapsed
              ? "从页头左侧展开设定树，选择一个设定查看详情"
              : "从左侧选择一个设定查看详情"}
          </EmptyState>
        </div>
      </section>
    ) : (
      <EntityDetail
        key={`setting:${id}`}
        type="setting"
        id={id}
        leading={railToggle}
        onDirtyChange={setDetailDirty}
        onSaved={() => setTick((t) => t + 1)}
      />
    );

  // rail：桌面展开态有；窄屏只在无 id（树页）时有；桌面收起态 = 0px（不渲染 rail，详情列吸收宽度）
  const showRail = !railCollapsed && (isDesktop || id === undefined);
  // 详情列：桌面收起态整列不渲染（不留空容器）；窄屏只在有 id 时渲染
  const showDetailColumn = !detailHidden && (isDesktop || id !== undefined);

  return (
    // -m-6 / h-[calc(100%+3rem)]：抵消中栏内容区的 p-6（同大纲页 / 人物工作台外壳，见 DESIGN.md
    // §Layout「设定页的中栏内分栏」）；详情列内补回同一内边距。
    // 拖拽期间根容器禁文本选中（指针已 capture 在手柄上，兜底防边缘选中）。
    <section
      className={cn(
        "-m-6 flex h-[calc(100%+3rem)] min-h-0 overflow-hidden",
        resizing && "select-none",
      )}
    >
      {showRail && (
        <SettingRail
          railRef={railRef}
          nodeId={id ?? null}
          reloadKey={tick}
          onSelect={selectNode}
          // 右侧详情收起 = rail 吸收全宽（不写 layout.width）；窄屏全宽同此口径
          width={
            isDesktop && !detailHidden
              ? layout.width !== null
                ? `${layout.width}px`
                : SETTING_RAIL_DEFAULT_WIDTH_CSS
              : undefined
          }
          // 无邻栏时抹掉 rail 自带的右边线（DESIGN.md §Layout「分栏边线单所有权」）；
          // 右侧详情收起时邻栏不在，同窄屏
          className={isDesktop && !detailHidden ? undefined : "w-full border-r-0"}
          // 详情收起按钮只在桌面态传给 rail（窄屏无相邻详情列）
          detailCollapsed={isDesktop ? layout.detailCollapsed : undefined}
          onToggleDetail={isDesktop ? toggleDetailWithGuard : undefined}
        />
      )}
      {/* 桌面展开态右边界 6px 拖拽手柄；收起态 / 窄屏 / 详情收起（rail 全宽）不渲染 */}
      {isDesktop && !railCollapsed && !detailHidden && (
        <ResizeHandle
          label="调整设定树宽度"
          active={resizing}
          onStart={startResize}
          onMove={moveResize}
          onEnd={endResize}
        />
      )}
      {showDetailColumn && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-6">
          {/* 窄屏「设定树」返回条（32px，滚动区之外；dirty 时先确认） */}
          {!isDesktop && id !== undefined && (
            <a
              href="#/setting"
              onClick={(e) => {
                e.preventDefault();
                void confirmDiscard().then((ok) => {
                  if (ok) navigate("/setting");
                });
              }}
              className="flex h-8 shrink-0 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftOutlined className="text-xs" />
              设定树
            </a>
          )}
          {detail}
        </div>
      )}
    </section>
  );
}
