// 时间轴组块（F4，timeline.md 时间点分组线框）
// 职责：组标题行（大圆点 + 拖拽柄 + 时间标签 + 事件计数 + 折叠按钮）+ 组内事件堆叠。
// 拖拽为**组块级**（本组件根 draggable）：组内事件行不 draggable 防误拖（F4 线框）；
// 插入指示线跨全宽（同 F3 S13 模式）；dragstart 被拖组块 opacity-50。
// 折叠（collapsed）：折叠后仅标题行、轴线仍连续（容器级贯穿）；折叠按钮 aria-expanded。
import type { DragEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TimelineGroup } from "../../lib/timeline";
import { cn } from "../../lib/utils";
import { TimelineEvent } from "./TimelineEvent";

interface TimelineGroupBlockProps {
  group: TimelineGroup;
  /** 兜底组（未标注时间）：标题斜体占位样式（timeline.md「未标注时间」处理） */
  isFallback: boolean;
  collapsed: boolean;
  /** 本组块被拖拽中（opacity-50） */
  dragging: boolean;
  /** 拖拽在途（防并发；draggable 禁用） */
  busy: boolean;
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  onToggleCollapse: () => void;
  /** 插入指示线（S13 模式：组块上下边缘） */
  showInsertBefore: boolean;
  showInsertAfter: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDetail: (ev: EntitySummary) => void;
  onEdit: (ev: EntitySummary) => void;
  onDelete: (ev: EntitySummary) => void;
}

export function TimelineGroupBlock({
  group,
  isFallback,
  collapsed,
  dragging,
  busy,
  occursCount,
  hasOccursData,
  onToggleCollapse,
  showInsertBefore,
  showInsertAfter,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDetail,
  onEdit,
  onDelete,
}: TimelineGroupBlockProps) {
  const title = isFallback ? "未标注时间" : group.label;
  return (
    <div
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn("relative flex flex-col gap-2", dragging && "opacity-50")}
    >
      {/* 插入指示线（S13 模式：目标组块上下边缘，跨圆点列与内容） */}
      {showInsertBefore && <div className="absolute inset-x-0 -top-px h-0.5 bg-primary" />}
      {showInsertAfter && <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
      {/* 组标题行：大圆点 + 拖拽柄 + 时间标签（F4 醒目层级 text-sm font-medium text-foreground）+
          事件计数 + 折叠按钮 */}
      <div className="flex items-start">
        {/* 大圆点（同 F3 事件行样式：mx-auto 居中于轴线列，圆心 = 轴线；z-10 + 不透明背景盖住穿过的轴线；
            mt-[6px] = 组标题文字中心（标题行 py-1 4px + text-sm 行盒中心 10px = 14px，圆点 16px 中心 offset 8px → 14 - 8 = 6px；
            F3 事件行的 mt-[12px] 对齐的是卡片首行中心 20px，标题行无卡片、高度 28px，故取 6px） */}
        <div className="w-[22px] shrink-0">
          <span
            aria-hidden="true"
            className="relative z-10 mx-auto mt-[6px] block size-4 rounded-full border-2 border-primary bg-background"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
          <span
            className="cursor-grab text-muted-foreground/60 active:cursor-grabbing"
            title="拖拽调整组间顺序"
            aria-hidden="true"
          >
            <GripVertical className="size-4" />
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-sm font-medium",
              // 兜底组占位样式（timeline.md：与正常组标题区分——muted 斜体）
              isFallback ? "italic text-muted-foreground" : "text-foreground",
            )}
            title={title}
          >
            {title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{group.events.length} 个事件</span>
          <span className="ml-auto shrink-0">
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
              <ChevronRight className={cn("size-4 transition-transform duration-200", !collapsed && "rotate-90")} />
            </Button>
          </span>
        </div>
      </div>
      {/* 组内事件堆叠（折叠隐藏组内事件，标题行仍在、轴线连续贯穿；各自不再画线） */}
      {!collapsed && (
        <div className="flex flex-col gap-2">
          {group.events.map((ev) => (
            <TimelineEvent
              key={ev.id}
              ev={ev}
              occursCount={occursCount}
              hasOccursData={hasOccursData}
              onDetail={onDetail}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
