// 时间轴组块（G2.3，timeline.md G2 布局线框：时间点组块）
// 职责：组标题行（大圆点 + 左侧折叠按钮 + 时间点名；右侧：事件计数 + [重命名] + [+ 在此时间点新建事件] +
//   [移入回收站]）+ 组内事件堆叠；**未挂载兜底区复用本组件**（timepoint = null）。
// 拖拽柄视觉已移除（批次八 O3）：draggable 仍设在组标题行根，悬停 title 提示拖拽能力，无 GripVertical 图标。
// 折叠按钮位序（批次八 O4）：移至组标题**左侧**（标题前，同大纲页折叠箭头在标题左边），不再靠右。
// 拖拽（G2 双轨）：
// - 时间点整组拖拽：draggable 设在**组标题行根**（组内事件行各自 draggable——G2 恢复单条拖拽，
//   两者是兄弟节点不嵌套，无 F4 防误拖冲突）；dragover/drop 以标题行中点判定插入位（容器协调）
// - 未挂载区**不可拖拽**（无时间点可排，timeline.md 线框）；组内事件可拖入（move_to null 移除挂载）
// 重命名（G2）：[重命名] → 行内输入框（预填当前名）→ Enter 提交（onRename 回调交页面 PUT + 刷新）、
//   Esc/失焦取消；编辑态禁用标题行拖拽（防输入误拖）。
// 折叠（collapsed）：折叠后仅标题行、轴线仍连续（容器级贯穿）；折叠按钮 aria-expanded。
// 视觉全走 tokens（layout.md §3 纪律）：无硬编码色类。
import { useState } from "react";
import type { DragEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "../../lib/utils";
import { TimelineEvent, type EventDragHandlers } from "./TimelineEvent";

/** 拖拽来源（G2 双轨：时间点整组 / 事件单条；容器协调用，经 dataTransfer + ref 双通道） */
export type TimelineDragSource = { kind: "timepoint"; id: string } | { kind: "event"; id: string };

interface TimelineGroupBlockProps {
  /** 时间点实体（null = 未挂载兜底区：标题「未挂载」italic muted、不可拖拽、无重命名/组内新建） */
  timepoint: EntitySummary | null;
  /** 组 id（时间点 id；未挂载区恒 ""） */
  groupId: string;
  /** 组内事件（已按事件全局 sort_order 投影序） */
  events: EntitySummary[];
  collapsed: boolean;
  /** 拖拽来源（容器状态；本组/本组事件行拖拽中 → opacity-50；未挂载区无来源可命中） */
  dragSource: TimelineDragSource | null;
  /** 拖拽在途（防并发；draggable 禁用） */
  busy: boolean;
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /** 插入指示线（S13 模式：组块上下边缘） */
  showInsertBefore: boolean;
  showInsertAfter: boolean;
  onToggleCollapse: () => void;
  /** 重命名提交（页面执行 PUT /entity/timepoint/:id { name } + toast + 刷新；仅时间点组） */
  onRename: (id: string, name: string) => Promise<void>;
  /** 移入回收站（页面直接软删，不弹确认；仅时间点组） */
  onDeleteTimepoint: (tp: EntitySummary) => void;
  /** 标题行「+ 在此时间点新建事件」（页面打开带预挂载的新建对话框；仅时间点组） */
  onAddEventAt: (timepointId: string) => void;
  // 组标题行拖拽（时间点整组；容器装配）
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  // 组内事件行拖拽（容器统一装配，转发给每个 TimelineEvent）
  eventDrag: EventDragHandlers;
  /** 行级插入指示线判定（事件拖拽落点；由容器 dropTarget 状态计算） */
  eventInsertLines: (eventId: string) => { before: boolean; after: boolean };
  onDetail: (ev: EntitySummary) => void;
  onEdit: (ev: EntitySummary) => void;
  onDelete: (ev: EntitySummary) => void;
}

export function TimelineGroupBlock({
  timepoint,
  groupId,
  events,
  collapsed,
  dragSource,
  busy,
  occursCount,
  hasOccursData,
  showInsertBefore,
  showInsertAfter,
  onToggleCollapse,
  onRename,
  onDeleteTimepoint,
  onAddEventAt,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  eventDrag,
  eventInsertLines,
  onDetail,
  onEdit,
  onDelete,
}: TimelineGroupBlockProps) {
  // 重命名行内编辑（G2：按钮 → 输入框预填 → Enter 提交、Esc/失焦取消）
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const isUngrouped = timepoint === null;
  const title = isUngrouped ? "未挂载" : timepoint.name;
  // 拖拽态（G2 双轨：时间点整组 / 事件单条——拖拽来源命中本组/本行 → opacity-50）
  const groupDragging =
    dragSource !== null && dragSource.kind === "timepoint" && dragSource.id === groupId;

  function startRename() {
    if (timepoint === null) return;
    setNameValue(timepoint.name);
    setEditing(true);
  }

  /** Enter 提交：trim 后空/未变 → 直接退出编辑；否则交页面（PUT + toast + 刷新）；失败由页面 toast（已退出编辑态，可重新点重命名） */
  async function commitRename() {
    if (timepoint === null) return;
    const name = nameValue.trim();
    setEditing(false);
    if (name === "" || name === timepoint.name) return;
    await onRename(timepoint.id, name);
  }

  return (
    <div className="relative flex flex-col gap-2">
      {/* 插入指示线（S13 模式：目标组块上下边缘，跨圆点列与内容） */}
      {showInsertBefore && <div className="absolute inset-x-0 -top-px h-0.5 bg-primary" />}
      {showInsertAfter && <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
      {/* 组标题行（draggable：时间点整组拖拽，无视觉拖拽柄（批次八 O3）；未挂载区/编辑态不 draggable） */}
      <div
        draggable={!isUngrouped && !busy && !editing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        title={!isUngrouped ? "拖拽调整时间点顺序（组内事件不动）" : undefined}
        className={cn("flex items-start", !isUngrouped && groupDragging && "opacity-50")}
      >
        {/* 大圆点（F4 样式：mx-auto 居中于轴线列，圆心 = 轴线；z-10 + 不透明背景盖住穿过的轴线；
            mt-[6px] = 组标题文字中心（标题行 py-1 4px + text-sm 行盒中心 10px = 14px，
            圆点 16px 中心 offset 8px → 14 - 8 = 6px）；未挂载区虚线弱化（italic muted 配套） */}
        <div className="w-[22px] shrink-0">
          <span
            aria-hidden="true"
            className={cn(
              "relative z-10 mx-auto mt-[6px] block size-4 rounded-full border-2 bg-background",
              isUngrouped ? "border-dashed border-border" : "border-primary",
            )}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
          {/* 折叠/展开按钮（批次八 O4：移至组标题左侧、标题前，同大纲页折叠箭头位序；折叠后仅标题行） */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            draggable={false}
            className="text-muted-foreground"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "展开" : "折叠"}「${title}」组`}
            onClick={onToggleCollapse}
          >
            {/* chevron 展开旋转惯例（layout.md §2.3）：折叠时横指，展开时向下 */}
            <ChevronRight
              className={cn(
                "size-4 transition-transform duration-200",
                !collapsed && "rotate-90",
              )}
            />
          </Button>
          {editing ? (
            <input
              autoComplete="off"
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                else if (e.key === "Escape") setEditing(false);
              }}
              onBlur={() => setEditing(false)}
              maxLength={100}
              aria-label="时间点名称"
              className="w-40 rounded-md border border-border bg-background px-2 py-0.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          ) : (
            <span
              className={cn(
                "min-w-0 truncate text-sm font-medium",
                // 未挂载区占位样式（timeline.md：与正常组标题区分——muted 斜体）
                isUngrouped ? "text-muted-foreground italic" : "text-foreground",
              )}
              title={title}
            >
              {title}
            </span>
          )}
          {/* 右侧信息与操作区（H5：事件计数、重命名、在此时间点新建事件、移入回收站全部靠右；
              折叠按钮已移至左侧（批次八 O4）） */}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <span className="shrink-0 text-xs text-muted-foreground">{events.length} 个事件</span>
            {/* 重命名（H5：图标按钮，减少文字干扰） */}
            {timepoint !== null && !editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                draggable={false}
                className="text-muted-foreground"
                title="重命名"
                aria-label={`重命名「${timepoint.name}」`}
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
            {/* 在此时间点新建事件（H5：图标按钮，减少文字干扰） */}
            {timepoint !== null && !editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                draggable={false}
                className="text-muted-foreground"
                title="在此时间点新建事件"
                aria-label={`在此时间点新建事件`}
                onClick={() => onAddEventAt(groupId)}
              >
                <Plus className="size-3.5" />
              </Button>
            )}
            {/* 移入回收站（H1：时间点组标题直接显示删除图标——用户反馈缺失删除入口；
                H2：点击直接软删不弹确认；未挂载区不渲染） */}
            {timepoint !== null && !editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                draggable={false}
                className="text-muted-foreground hover:text-destructive"
                title="移入回收站"
                aria-label={`移入回收站「${timepoint.name}」`}
                onClick={() => onDeleteTimepoint(timepoint)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </span>
        </div>
      </div>
      {/* 组内事件堆叠（折叠隐藏组内事件，标题行仍在、轴线连续贯穿；各自不再画线） */}
      {!collapsed && (
        <div className="flex flex-col gap-2">
          {events.map((ev) => {
            const lines = eventInsertLines(ev.id);
            return (
              <TimelineEvent
                key={ev.id}
                ev={ev}
                occursCount={occursCount}
                hasOccursData={hasOccursData}
                dragging={
                  dragSource !== null && dragSource.kind === "event" && dragSource.id === ev.id
                }
                busy={busy}
                showInsertBefore={lines.before}
                showInsertAfter={lines.after}
                eventDrag={eventDrag}
                onDetail={onDetail}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
