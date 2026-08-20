// 时间轴容器（G2.3，timeline.md G2 布局线框：时间点组块 + 事件挂载 + 未挂载兜底区 + 双轨拖拽）
// 职责：垂直轴线 + 双实体模型渲染（buildTimelineModel：组 = 真实时间点实体 + occurs_at 挂载，
//   未挂载区 = 无挂载事件平铺）+ **双轨拖拽协调**（时间点整组 / 事件单条，dragstart 来源判定互斥）。
// 数据编排留在页面（Timeline.tsx）——本组件收「全量时间点 + 事件」与回调（纯展示/交互职责）：
//   - 渲染模型 = buildTimelineModel(timepoints, events, occursAtEdges)：events 为**已筛选**事件
//   - order 计算模型 = buildTimelineModel(timepoints, allEvents, occursAtEdges)：allEvents 为**全量**
//     事件（order 是全局事件线性序——筛选态下以全量序为基准，避免错位）
// 双轨拖拽（G2，timeline.md 拖拽节）：
//   - 时间点拖拽：组标题行根 draggable（TimelineGroup 装配）；落点 = 任意组块区域（标题行/事件行
//     均组级判定：side 按落点元素中点）→ drop → PUT /entity/timepoint/:id/move（**只重排时间点序，
//     其下事件不动**）；未挂载区不可作为时间点目标（无时间点语义）
//   - 事件拖拽：事件行根 draggable（TimelineEvent 装配）；落点 = 事件行 → 行级判定（行中点 →
//     before/after 该行）；落点 = 标题行 → 组级判定（组首/组尾）；空组/空未挂载区 → 组块边缘指示线
//     → drop → 同组 = PUT /entity/event/:id/move（只重排）；跨组 = POST /entity/event/:id/move_to
//     （改挂载 + 重排，事务原子；null = 移出到未挂载区）
//   - order 计算统一走 lib eventOrderIntoGroup（组序 + 未挂载区序投影、剔除拖拽项、空组相邻锚推断）
// 折叠状态（collapsedGroups）容器内 state：MVP 不做持久化（页面切换不保留）。
import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { buildTimelineModel, eventDropOrder, eventOrderIntoGroup } from "../../lib/timeline";
import type { RelationSummaryItem } from "../../lib/api";
import { TimelineGroupBlock, type TimelineDragSource } from "./TimelineGroup";

/** 组块渲染视图（容器从 lib 模型转换）：真实时间点组 + 未挂载兜底区（timepoint null）统一结构 */
interface GroupView {
  timepoint: EntitySummary | null;
  groupId: string;
  events: EntitySummary[];
}

interface TimelineProps {
  /** 全量时间点（sort_order 序；组块渲染 + 时间点拖拽 order 计算） */
  timepoints: EntitySummary[];
  /** 已筛选事件（页面按标签筛选后传入；sort_order 序——渲染模型） */
  events: EntitySummary[];
  /** 全量事件（sort_order 序——order 计算模型基准，筛选态防错位） */
  allEvents: EntitySummary[];
  /** occurs_at 挂载边（timepoint → event；拉取失败页面降级空数组——全部事件视为未挂载） */
  occursAtEdges: RelationSummaryItem[];
  /** 行内「N 节点」计数（occurs_in 关联数；锚定边失败时页面降级传 0） */
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /** 时间点拖拽结果 → 页面执行 PUT /entity/timepoint/:id/move（成功后刷新、失败回滚 toast） */
  onMoveTimepoint: (id: string, order: number) => Promise<void>;
  /** 事件同组重排 → 页面执行 PUT /entity/event/:id/move */
  onMoveEvent: (id: string, order: number) => Promise<void>;
  /** 事件跨组改挂载 → 页面执行 POST /entity/event/:id/move_to（timepointId null = 未挂载区） */
  onMoveEventTo: (id: string, timepointId: string | null, order: number) => Promise<void>;
  /** 时间点重命名提交（页面执行 PUT /entity/timepoint/:id { name }；失败抛错——页面 toast） */
  onRenameTimepoint: (id: string, name: string) => Promise<void>;
  /** 时间点移入回收站（页面直接软删，不弹确认） */
  onDeleteTimepoint: (tp: EntitySummary) => void;
  /** 组尾「+ 在此时间点新建事件」（页面打开带预挂载的新建对话框） */
  onAddEventAt: (timepointId: string) => void;
  /** 组标题行双击 → 时间点详情（页面跳 #/entities/timepoint/:id） */
  onDetailTimepoint: (tp: EntitySummary) => void;
  /** 事件行操作回调（页面级动作） */
  onDetail: (ev: EntitySummary) => void;
  /** 事件名行内编辑提交（页面执行 PUT /entity/event/:id { name }；失败抛错——页面 toast） */
  onEditName: (id: string, name: string) => Promise<void>;
  onDelete: (ev: EntitySummary) => void;
}

/** 事件拖拽落点（指示线 + drop 计算）：行级 = 锚定该行（行边缘指示线）；组级 = 组首/组尾
 * （锚 = 组首/末事件 id，空组 null——组块边缘指示线）；时间点拖拽 = 组间插入位（组块边缘） */
type DropTarget =
  | { kind: "timepoint"; side: "before" | "after"; groupId: string }
  | {
      kind: "event";
      at: "row" | "group";
      side: "before" | "after";
      groupId: string;
      anchorId: string | null;
    };

export function Timeline({
  timepoints,
  events,
  allEvents,
  occursAtEdges,
  occursCount,
  hasOccursData,
  onMoveTimepoint,
  onMoveEvent,
  onMoveEventTo,
  onRenameTimepoint,
  onDeleteTimepoint,
  onAddEventAt,
  onDetailTimepoint,
  onDetail,
  onEditName,
  onDelete,
}: TimelineProps) {
  // 渲染模型（已筛选事件）与 order 计算模型（全量事件）——组序同源（timepoints 序）
  const renderModel = useMemo(
    () => buildTimelineModel(timepoints, events, occursAtEdges),
    [timepoints, events, occursAtEdges],
  );
  const orderModel = useMemo(
    () => buildTimelineModel(timepoints, allEvents, occursAtEdges),
    [timepoints, allEvents, occursAtEdges],
  );
  // 视图组列表：真实时间点组 + 未挂载兜底区（有未挂载事件才追加；组标题「未挂载」）
  const viewGroups = useMemo<GroupView[]>(
    () => [
      ...renderModel.groups.map((g) => ({
        timepoint: g.timepoint,
        groupId: g.timepoint.id,
        events: g.events,
      })),
      ...(renderModel.ungrouped.length > 0
        ? [{ timepoint: null as EntitySummary | null, groupId: "", events: renderModel.ungrouped }]
        : []),
    ],
    [renderModel],
  );
  // 事件 → 所属组 id（渲染模型；"" = 未挂载区——同组判定用）
  const eventGroupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of renderModel.groups) for (const ev of g.events) m.set(ev.id, g.timepoint.id);
    for (const ev of renderModel.ungrouped) m.set(ev.id, "");
    return m;
  }, [renderModel]);
  // 全量时间点 id 序（时间点拖拽 order 计算基准）
  const timepointIds = useMemo(() => timepoints.map((t) => t.id), [timepoints]);

  // 折叠状态（组 id → collapsed；MVP 不做 localStorage 持久化，页面切换不保留）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 拖拽态（G2 双轨：drag 来源 = dragstart 判定；dropTarget = 指示线 + drop 落点；busy 防并发）
  const [drag, setDrag] = useState<TimelineDragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [busy, setBusy] = useState(false);

  /** 落点元素中点判定：上半 → before、下半 → after（与 Outline.tsx insertSideFromEvent 同式） */
  function insertSideFromEvent(e: DragEvent<HTMLDivElement>): "before" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  /** 目标组在 order 模型中的下标（未挂载区 → -1）；groupId 不在组序中 → -1（防御：空组序拖拽） */
  function targetIndexOf(groupId: string): number {
    if (groupId === "") return -1;
    return orderModel.groups.findIndex((g) => g.timepoint.id === groupId);
  }

  /** 事件拖拽落点（行级/组级）→ dropTarget 状态（指示线）；时间点拖拽落点 → 组级判定 */
  function setEventDrop(
    e: DragEvent<HTMLDivElement>,
    groupId: string,
    anchor: { at: "row" | "group"; anchorId: string | null },
  ) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = insertSideFromEvent(e);
    setDropTarget((prev) => {
      if (
        prev !== null &&
        prev.kind === "event" &&
        prev.at === anchor.at &&
        prev.side === side &&
        prev.groupId === groupId &&
        prev.anchorId === anchor.anchorId
      ) {
        return prev;
      }
      return { kind: "event", at: anchor.at, side, groupId, anchorId: anchor.anchorId };
    });
  }

  // ============ 拖拽源（dragstart：双轨互斥判定） ============

  /** 时间点整组拖拽开始（组标题行根；dataTransfer 承载 id——防 ref 丢失） */
  function handleTimepointDragStart(e: DragEvent<HTMLDivElement>, g: GroupView) {
    if (g.timepoint === null) return;
    e.dataTransfer.setData("text/plain", g.timepoint.id);
    e.dataTransfer.effectAllowed = "move";
    setDrag({ kind: "timepoint", id: g.timepoint.id });
    setDropTarget(null);
  }

  /** 事件单条拖拽开始（事件行根） */
  function handleEventDragStart(e: DragEvent<HTMLDivElement>, ev: EntitySummary) {
    e.dataTransfer.setData("text/plain", ev.id);
    e.dataTransfer.effectAllowed = "move";
    setDrag({ kind: "event", id: ev.id });
    setDropTarget(null);
  }

  /** 拖拽结束（任意来源）：清理拖拽态 */
  function clearDrag() {
    setDrag(null);
    setDropTarget(null);
  }

  // ============ dragover（落点判定：组级 / 行级） ============

  /** 组块 dragover（组标题行根）：时间点拖拽 → 组间插入位；事件拖拽 → 组首/组尾 */
  function handleGroupDragOver(e: DragEvent<HTMLDivElement>, g: GroupView) {
    const cur = drag;
    if (cur === null) return;
    // 未挂载区不可作为时间点目标（无时间点语义；不 preventDefault → drop 不触发，浏览器显示禁止光标）
    if (cur.kind === "timepoint" && g.timepoint === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = insertSideFromEvent(e);
    if (cur.kind === "timepoint") {
      setDropTarget((prev) =>
        prev !== null &&
        prev.kind === "timepoint" &&
        prev.side === side &&
        prev.groupId === g.groupId
          ? prev
          : { kind: "timepoint", side, groupId: g.groupId },
      );
      return;
    }
    // 事件拖拽：组级锚点 = 组首/末事件（空组 → null——组块边缘指示线）
    const anchorId =
      g.events.length === 0
        ? null
        : side === "before"
          ? g.events[0].id
          : g.events[g.events.length - 1].id;
    setEventDrop(e, g.groupId, { at: "group", anchorId });
  }

  /** 事件行 dragover（行级判定；时间点拖拽落点在事件行 → 该行所属组的组级判定） */
  function handleEventDragOver(e: DragEvent<HTMLDivElement>, ev: EntitySummary, g: GroupView) {
    const cur = drag;
    if (cur === null) return;
    // 未挂载区的事件行：时间点拖拽不可作为目标（同组块根判定）
    if (cur.kind === "timepoint" && g.timepoint === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (cur.kind === "timepoint") {
      // 时间点拖拽落点在事件行：视为该组的组级插入位（side 按行中点）。
      // ⚠ side 必须在 updater 外计算——合成事件 currentTarget 在事件处理结束后被
      // React 清空，updater 延迟执行时访问 e.currentTarget 会得到 null（拖拽崩溃根因）
      const side = insertSideFromEvent(e);
      setDropTarget((prev) =>
        prev !== null &&
        prev.kind === "timepoint" &&
        prev.side === side &&
        prev.groupId === g.groupId
          ? prev
          : { kind: "timepoint", side, groupId: g.groupId },
      );
      return;
    }
    // 事件拖拽：行级锚点 = 本行
    setEventDrop(e, g.groupId, { at: "row", anchorId: ev.id });
  }

  // ============ drop（落点执行：按拖拽来源 + 落点判定调对应 move） ============

  /** 事件拖拽 drop 执行（行级/组级统一）：同组 → move；跨组/未挂载区 → move_to */
  async function executeEventDrop(
    e: DragEvent<HTMLDivElement>,
    g: GroupView,
    anchorId: string | null,
  ) {
    const cur = drag;
    if (cur === null || cur.kind !== "event" || busy) return;
    e.preventDefault();
    // 拖到自身行（原地）→ 跳过（无意义请求）
    if (anchorId === cur.id) {
      clearDrag();
      return;
    }
    const side = insertSideFromEvent(e);
    const order = eventOrderIntoGroup(
      orderModel.groups,
      orderModel.ungrouped,
      targetIndexOf(g.groupId),
      side,
      cur.id,
    );
    const currentGroupId = eventGroupOf.get(cur.id) ?? "";
    setBusy(true);
    try {
      if (g.groupId === currentGroupId) {
        // 同组：只重排（PUT /entity/event/:id/move）
        await onMoveEvent(cur.id, order);
      } else {
        // 跨组：改挂载 + 重排（POST /entity/event/:id/move_to；"" → null = 移出到未挂载区）
        await onMoveEventTo(cur.id, g.groupId === "" ? null : g.groupId, order);
      }
    } finally {
      setBusy(false);
      clearDrag();
    }
  }

  /** 组块 drop（组标题行根）：时间点拖拽 → moveTimepoint；事件拖拽 → 组级执行 */
  function handleGroupDrop(e: DragEvent<HTMLDivElement>, g: GroupView) {
    const cur = drag;
    if (cur === null || busy) return;
    e.preventDefault();
    if (cur.kind === "timepoint") {
      if (g.timepoint === null) return; // 未挂载区不可作为时间点目标
      if (g.groupId === cur.id) {
        clearDrag(); // 拖回自身组 → 原地跳过
        return;
      }
      const side = insertSideFromEvent(e);
      const order = eventDropOrder(timepointIds, { kind: side, id: g.groupId }, cur.id);
      setBusy(true);
      void onMoveTimepoint(cur.id, order).finally(() => {
        setBusy(false);
        clearDrag();
      });
      return;
    }
    // 事件拖拽：组级锚点 = 组首/末事件（空组 → null）
    const side = insertSideFromEvent(e);
    const anchorId =
      g.events.length === 0
        ? null
        : side === "before"
          ? g.events[0].id
          : g.events[g.events.length - 1].id;
    void executeEventDrop(e, g, anchorId);
  }

  /** 事件行 drop（行级）：锚 = 本行；时间点拖拽落点 → 复用组级执行（指示线已承诺组级插入位，
   * 行级守卫会拦截——oracle G2.3 P1：指示线-行为一致性） */
  function handleEventDrop(e: DragEvent<HTMLDivElement>, ev: EntitySummary, g: GroupView) {
    const cur = drag;
    if (cur !== null && cur.kind === "timepoint") {
      handleGroupDrop(e, g);
      return;
    }
    void executeEventDrop(e, g, ev.id);
  }

  function toggleCollapse(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="relative flex flex-col gap-2">
      {/* 垂直轴线（left-[11px] = 节点列中心；pointer-events-none 是拖拽共存前提，行间/组间空隙处线连续贯穿） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bottom-0 left-[11px] w-0.5 bg-border"
      />
      {viewGroups.map((g) => {
        // 组块级指示线：时间点插入位（该组）或事件组级落点（该组；含空组无锚点）
        const groupLine =
          dropTarget !== null &&
          ((dropTarget.kind === "timepoint" && dropTarget.groupId === g.groupId) ||
            (dropTarget.kind === "event" &&
              dropTarget.at === "group" &&
              dropTarget.groupId === g.groupId));
        const showInsertBefore = groupLine && dropTarget !== null && dropTarget.side === "before";
        const showInsertAfter = groupLine && dropTarget !== null && dropTarget.side === "after";
        // 行级指示线：事件拖拽锚点行（at === "row" 且锚点匹配）
        const rowLineBefore =
          dropTarget !== null &&
          dropTarget.kind === "event" &&
          dropTarget.at === "row" &&
          dropTarget.side === "before";
        const rowLineAfter =
          dropTarget !== null &&
          dropTarget.kind === "event" &&
          dropTarget.at === "row" &&
          dropTarget.side === "after";
        const eventDragHandlers = {
          onDragStart: handleEventDragStart,
          onDragEnd: clearDrag,
          onDragOver: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) =>
            handleEventDragOver(e, ev, g),
          onDrop: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => handleEventDrop(e, ev, g),
        };
        return (
          <TimelineGroupBlock
            key={g.groupId === "" ? "__ungrouped__" : g.groupId}
            timepoint={g.timepoint}
            groupId={g.groupId}
            events={g.events}
            collapsed={collapsedGroups.has(g.groupId)}
            dragSource={drag}
            busy={busy}
            occursCount={occursCount}
            hasOccursData={hasOccursData}
            showInsertBefore={showInsertBefore}
            showInsertAfter={showInsertAfter}
            onToggleCollapse={() => toggleCollapse(g.groupId)}
            onRename={onRenameTimepoint}
            onDeleteTimepoint={onDeleteTimepoint}
            onAddEventAt={onAddEventAt}
            onDetailTimepoint={onDetailTimepoint}
            onDragStart={(e) => handleTimepointDragStart(e, g)}
            onDragEnd={clearDrag}
            onDragOver={(e) => handleGroupDragOver(e, g)}
            onDrop={(e) => handleGroupDrop(e, g)}
            eventDrag={eventDragHandlers}
            eventInsertLines={(eventId) => ({
              before:
                rowLineBefore &&
                dropTarget !== null &&
                dropTarget.kind === "event" &&
                dropTarget.anchorId === eventId,
              after:
                rowLineAfter &&
                dropTarget !== null &&
                dropTarget.kind === "event" &&
                dropTarget.anchorId === eventId,
            })}
            onDetail={onDetail}
            onEditName={onEditName}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}
