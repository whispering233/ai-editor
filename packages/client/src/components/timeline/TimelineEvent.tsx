// 时间轴事件行（G2.3，timeline.md G2 布局线框：组内事件堆叠；F5 时间标签样式已随 G2 移除——
//   时间标签 = 组标题（时间点实体），行内不再展示；F6 行内描述展示保留）
// 职责：纯展示 + 单条拖拽（G2 双轨：事件行 draggable，恢复 F3 能力）——
//   行 = 小圆点 + 内容卡（拖拽柄 GripVertical → 事件名 → tags → 「N 节点」→ ⋯ 菜单 + 描述区）。
// 拖拽协调在容器（components/timeline/Timeline.tsx）——本行只负责 draggable 挂载与回调转发：
//   行内按钮 draggable={false} 防拖（菜单/展开按钮）；opacity-50 拖拽态；插入指示线（S13 模式）。
// 描述区（F6）：事件名行下方全宽换行，`text-sm text-muted-foreground` 次要层级（低于事件名）；
//   两行截断（line-clamp-2）——**超过两行才显示「展开」按钮**（clamp 态 scrollHeight > clientHeight
//   运行时测量，窗口 resize 重测；**展开态跳过重测**——line-clamp 解除后无法测 clamp 溢出，
//   保留上次 clamped 测量值）；展开后 line-clamp-none 显示「收起」；空描述不渲染。
import { useLayoutEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { eventDescription, eventTagsOf } from "../../lib/timeline";
import { cn } from "../../lib/utils";

/** 事件行拖拽回调（容器统一装配：dragstart/dragover/drop 需结合拖拽来源与落点行判定） */
export interface EventDragHandlers {
  onDragStart: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, ev: EntitySummary) => void;
}

interface TimelineEventProps {
  ev: EntitySummary;
  /** 行内「N 节点」计数（occurs_in 关联数；锚定边拉取失败时页面传 0 + hasOccursData=false 降级隐藏） */
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /** 本行被拖拽中（opacity-50） */
  dragging: boolean;
  /** 拖拽在途（防并发；draggable 禁用） */
  busy: boolean;
  /** 插入指示线（S13 模式：行上下边缘——事件拖拽落点判定以行中点为准） */
  showInsertBefore: boolean;
  showInsertAfter: boolean;
  eventDrag: EventDragHandlers;
  /** 行 ⋯ 菜单回调（页面级动作：详情跳转 / 编辑对话框 / 软删直接执行） */
  onDetail: (ev: EntitySummary) => void;
  onEdit: (ev: EntitySummary) => void;
  onDelete: (ev: EntitySummary) => void;
}

export function TimelineEvent({
  ev,
  occursCount,
  hasOccursData,
  dragging,
  busy,
  showInsertBefore,
  showInsertAfter,
  eventDrag,
  onDetail,
  onEdit,
  onDelete,
}: TimelineEventProps) {
  const tags = eventTagsOf(ev);
  const description = eventDescription(ev);
  const count = occursCount(ev.id);
  // 描述展开态（F6：事件行级独立 state；展开后 line-clamp-none）
  const [expanded, setExpanded] = useState(false);
  // 描述是否超过两行（clamp 态 scrollHeight > clientHeight → 才显示「展开」按钮）。
  // 测量时机：挂载/描述变化/窗口 resize（描述区宽度只随窗口变化——中栏 flex-basis 固定）；
  // 展开/收起切换重跑 effect（依赖含 expanded）：展开态跳过测量（clamp 解除后 scrollHeight ===
  // clientHeight 恒不溢出，照测会污染 overflowing 导致收起后「展开」按钮消失——保留上次 clamped
  // 测量值）；收起后 effect 重跑，在 clamped 态重测恢复。
  // 用 useLayoutEffect：测量在 paint 前执行，消除首帧「展开」按钮延迟与布局位移（CLS）。
  const descRef = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = descRef.current;
    if (el === null) return;
    const check = () => {
      if (expanded) return; // 展开态无法测 clamp 溢出，保留上次 clamped 测量值
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [description, expanded]);

  return (
    <div
      draggable={!busy}
      onDragStart={(e) => eventDrag.onDragStart(e, ev)}
      onDragEnd={eventDrag.onDragEnd}
      onDragOver={(e) => eventDrag.onDragOver(e, ev)}
      onDrop={(e) => eventDrag.onDrop(e, ev)}
      className={cn("relative flex items-start", dragging && "opacity-50")}
    >
      {/* 插入指示线（S13 模式：行上下边缘，跨圆点列与内容） */}
      {showInsertBefore && <div className="absolute inset-x-0 -top-px h-0.5 bg-primary" />}
      {showInsertAfter && <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
      {/* 组内小圆点（F4 保留：组内事件堆叠，小圆点 size-2 bg-primary/60 居中于轴线列——
          不再画大圆点盖线，轴线容器级贯穿；mt-[16px] = 内容中心 20px - 小圆点高 8px 中心 offset 4px） */}
      <div className="w-[22px] shrink-0">
        <span aria-hidden="true" className="mx-auto mt-[16px] block size-2 rounded-full bg-primary/60" />
      </div>
      {/* 内容卡（timeline.md G2 事件行：从左到右 拖拽柄 → 事件名 → tags → N 节点 → ⋯ 菜单；
          描述区 F6 在事件名行下方全宽换行，不挤占行内元素） */}
      <div className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          {/* 拖拽柄（G2 恢复 F3 单条拖拽：draggable 在行根，柄为视觉指示） */}
          <span
            className="shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing"
            title="拖拽调整事件顺序/挂载"
            aria-hidden="true"
          >
            <GripVertical className="size-4" />
          </span>
          <span className="min-w-0 truncate font-medium text-foreground" title={ev.name}>
            {ev.name}
          </span>
          {tags.map((tag) => (
            <span key={tag} className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {tag}
            </span>
          ))}
          {hasOccursData && <span className="shrink-0 text-xs text-muted-foreground">{count} 节点</span>}
          <span className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    draggable={false}
                    className="text-muted-foreground"
                    aria-label={`${ev.name} 操作`}
                  >
                    <MoreHorizontal />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {/* 详情页 #/timeline/:id（C4 启用） */}
                <DropdownMenuItem onClick={() => onDetail(ev)}>详情</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(ev)}>编辑</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(ev)}>
                  移入回收站
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        {/* 描述区（F6）：text-sm text-muted-foreground 次要层级；两行截断 + 展开/收起；
             trim 后为空不渲染；「展开」仅在超过两行时出现（overflowing 运行时测量） */}
        {description.trim() !== "" && (
          <div className="mt-1.5">
            <p
              ref={descRef}
              className={cn("text-sm leading-relaxed text-muted-foreground", !expanded && "line-clamp-2")}
            >
              {description}
            </p>
            {(expanded || overflowing) && (
              <button
                type="button"
                draggable={false}
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs text-primary hover:underline"
                aria-expanded={expanded}
              >
                {expanded ? "收起" : "展开"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
