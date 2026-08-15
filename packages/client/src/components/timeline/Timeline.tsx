// 时间轴容器（F4，timeline.md 时间点分组线框）
// 职责：垂直轴线 + 分组渲染 + 组块级拖拽协调（S13 上下半插入判定 + 插入指示线）。
// 数据编排留在页面（Timeline.tsx）——本组件只收「已筛选事件」与回调（纯展示/交互职责）：
//   拖拽 drop 后按组内序算出各事件的 move order（groupDropOrders 纯函数）→ onMove 回调交页面执行
//   （页面负责逐次 PUT /entity/event/:id/move + 成功/失败刷新回滚 + toast——规格「页面负责 move 调用」）。
// 拖拽语义（F4，timeline.md）：draggable 设在**组块根**（组内事件行不 draggable 防误拖）；
//   插入位按组块中点判定（上半 → before、下半 → after）——锚点 = before → 目标组**首事件**、
//   after → 目标组**末事件**（组间插入语义：after 若锚首事件，多事件目标组会被插进组内部）；
//   drop 后被拖组事件**按组内序逐个 move**（groupDropOrders 模拟服务端 moveEvent 逐次落位，
//   单事件组 = 与 F3 eventDropOrder 行为完全一致）；失败 → 页面重拉列表（服务端实际顺序为准，即回滚）。
// 折叠状态（collapsedGroups）容器内 state：MVP 不做持久化（页面切换不保留）。
import { useMemo, useState } from "react";
import type { DragEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import {
  groupDropOrders,
  groupEventsByTimeLabel,
  type TimelineDropInsert,
  type TimelineGroup,
} from "../../lib/timeline";
import { TimelineGroupBlock } from "./TimelineGroup";

interface TimelineProps {
  /** 已筛选事件（页面按标签筛选后传入；sort_order 线性序） */
  events: EntitySummary[];
  /** 行内「N 节点」计数（occurs_in 关联数；锚定边失败时页面降级传 0） */
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /**
   * 组块拖拽结果 → 页面执行 move（moves 已按组内序算好 order，须按序逐个调用；
   * 成功/失败后由页面刷新列表——成功保持新序、失败回滚为服务端实际顺序——并 toast）
   */
  onMove: (moves: Array<{ id: string; order: number }>) => Promise<void>;
  /** 事件行 ⋯ 菜单回调（页面级动作） */
  onDetail: (ev: EntitySummary) => void;
  onEdit: (ev: EntitySummary) => void;
  onDelete: (ev: EntitySummary) => void;
}

export function Timeline({ events, occursCount, hasOccursData, onMove, onDetail, onEdit, onDelete }: TimelineProps) {
  // 时间点分组（筛选后的事件再分组；组序 = 组内最早事件 sort_order 投影）
  const groups = useMemo(() => groupEventsByTimeLabel(events), [events]);

  // 折叠状态（组 key → collapsed；MVP 不做 localStorage 持久化，页面切换不保留）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // 拖拽态（S13 模式：dragGroupIds 被拖组 + dropTarget 插入目标；busy 防并发拖拽）
  const [dragGroupIds, setDragGroupIds] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<TimelineDropInsert | null>(null);
  const [busy, setBusy] = useState(false);

  /** 拖拽点相对目标组块的位置：上半 → before、下半 → after（与 Outline.tsx insertSideFromEvent 同式） */
  function insertSideFromEvent(e: DragEvent<HTMLDivElement>): "before" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  /**
   * 组块插入锚点事件 id：before → 组内**首事件**、after → 组内**末事件**（F4 组间插入语义——
   * 锚首事件 + after 会把被拖组插进多事件目标组内部；末事件锚保证整块落在目标组之后）
   */
  function anchorOf(e: DragEvent<HTMLDivElement>, group: TimelineGroup): string {
    return insertSideFromEvent(e) === "before" ? group.events[0].id : group.events[group.events.length - 1].id;
  }

  /** 组块 dragover：设置插入目标（去重防高频重渲染；side 恒为 before|after，无 end 分支） */
  function handleDragOver(e: DragEvent<HTMLDivElement>, group: TimelineGroup) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = insertSideFromEvent(e);
    const anchorId = anchorOf(e, group);
    setDropTarget((prev) => {
      if (prev !== null && prev.kind !== "end" && prev.kind === side && prev.id === anchorId) return prev;
      return { kind: side, id: anchorId };
    });
  }

  /**
   * 组块 drop：按组内序算各事件 move order → onMove 交页面执行（groupDropOrders 模拟服务端
   * 逐次 move，最终组块保持组内序整体落在插入位）；拖到自身组块 = 原地，跳过。
   */
  async function handleDrop(e: DragEvent<HTMLDivElement>, group: TimelineGroup) {
    e.preventDefault();
    const groupIds = dragGroupIds;
    if (groupIds === null || busy) return;
    if (groupIds.includes(anchorOf(e, group))) {
      setDragGroupIds(null);
      setDropTarget(null);
      return;
    }
    const ids = events.map((i) => i.id);
    const insert: TimelineDropInsert = { kind: insertSideFromEvent(e), id: anchorOf(e, group) };
    const orders = groupDropOrders(ids, insert, groupIds);
    setBusy(true);
    try {
      await onMove(groupIds.map((id, i) => ({ id, order: orders[i] })));
    } finally {
      setBusy(false);
      setDragGroupIds(null);
      setDropTarget(null);
    }
  }

  function toggleCollapse(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="relative flex flex-col gap-2">
      {/* 垂直轴线（left-[11px] = 节点列中心；pointer-events-none 是拖拽共存前提，行间/组间空隙处线连续贯穿） */}
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-[11px] top-0 w-0.5 bg-border" />
      {groups.map((group) => {
        // 拖拽/插入判定均以组内事件归属为准（锚点事件必在组内：before 首事件 / after 末事件）
        const dragging = dragGroupIds !== null && group.events.some((ev) => dragGroupIds.includes(ev.id));
        const showInsertBefore =
          dropTarget !== null && dropTarget.kind === "before" && group.events.some((ev) => ev.id === dropTarget.id);
        const showInsertAfter =
          dropTarget !== null && dropTarget.kind === "after" && group.events.some((ev) => ev.id === dropTarget.id);
        return (
          <TimelineGroupBlock
            key={group.key}
            group={group}
            isFallback={group.key === ""}
            collapsed={collapsedGroups.has(group.key)}
            dragging={dragging}
            busy={busy}
            occursCount={occursCount}
            hasOccursData={hasOccursData}
            onToggleCollapse={() => toggleCollapse(group.key)}
            showInsertBefore={showInsertBefore}
            showInsertAfter={showInsertAfter}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", group.key);
              e.dataTransfer.effectAllowed = "move";
              setDragGroupIds(group.events.map((ev) => ev.id));
              setDropTarget(null);
            }}
            onDragEnd={() => {
              setDragGroupIds(null);
              setDropTarget(null);
            }}
            onDragOver={(e) => handleDragOver(e, group)}
            onDrop={(e) => void handleDrop(e, group)}
            onDetail={onDetail}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}
