// 时间轴事件行（F4，timeline.md 时间点分组线框：组内事件堆叠；F5 时间标签样式提升；F6 行内描述展示）
// 职责：纯展示——组内事件行 = 小圆点 + 内容卡（事件名 → 时间标签 → tags → 「N 节点」→ ⋯ 菜单 + 描述区）。
// 拖拽归组块级（TimelineGroup 根 draggable），本行**不 draggable 防误拖**（F4 线框），故无拖拽柄。
// 行内时间标签（F5）：有值 → 主题色点缀 `text-sm font-medium text-primary`（第二信息层级，仅次于
//   事件名；与 tags 胶囊 bg-muted 灰、组标题 text-foreground 实色均区分）；空 → 「未标注时间」占位
//   弱化样式（text-xs italic text-muted-foreground）——已标注/未标注一眼可辨。
// 描述区（F6）：事件名行下方全宽换行，`text-sm text-muted-foreground` 次要层级（低于事件名/时间标签）；
//   两行截断（line-clamp-2）——**超过两行才显示「展开」按钮**（clamp 态 scrollHeight > clientHeight
//   运行时测量，窗口 resize 重测；**展开态跳过重测**——line-clamp 解除后无法测 clamp 溢出，
//   保留上次 clamped 测量值）；展开后 line-clamp-none 显示「收起」；空描述不渲染。
import { useLayoutEffect, useRef, useState } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { eventDescription, eventTagsOf, eventTimeLabel } from "../../lib/timeline";
import { cn } from "../../lib/utils";

interface TimelineEventProps {
  ev: EntitySummary;
  /** 行内「N 节点」计数（occurs_in 关联数；锚定边拉取失败时页面传 0 + hasOccursData=false 降级隐藏） */
  occursCount: (id: string) => number;
  hasOccursData: boolean;
  /** 行 ⋯ 菜单回调（页面级动作：详情跳转 / 编辑对话框 / 软删确认） */
  onDetail: (ev: EntitySummary) => void;
  onEdit: (ev: EntitySummary) => void;
  onDelete: (ev: EntitySummary) => void;
}

export function TimelineEvent({ ev, occursCount, hasOccursData, onDetail, onEdit, onDelete }: TimelineEventProps) {
  const timeLabel = eventTimeLabel(ev);
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
    <div className="flex items-start">
      {/* 组内小圆点（F4：组内事件堆叠，小圆点 size-2 bg-primary/60 居中于轴线列——
          不再画大圆点盖线，轴线容器级贯穿；mt-[16px] = 内容中心 20px - 小圆点高 8px 中心 offset 4px） */}
      <div className="w-[22px] shrink-0">
        <span aria-hidden="true" className="mx-auto mt-[16px] block size-2 rounded-full bg-primary/60" />
      </div>
      {/* 内容卡（事件名行 + 描述区：F6 描述在下一行全宽换行，不挤占行内元素） */}
      <div className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground" title={ev.name}>
            {ev.name}
          </span>
          {/* 时间标签（F5 提升）：有值 → 主题色点缀（text-sm font-medium text-primary）；
              空 → 弱化占位（text-xs italic text-muted-foreground）——层级对比见文件头注释 */}
          {timeLabel !== "" ? (
            <span className="shrink-0 text-sm font-medium text-primary" title={timeLabel}>
              {timeLabel}
            </span>
          ) : (
            <span className="shrink-0 text-xs italic text-muted-foreground">未标注时间</span>
          )}
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
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`${ev.name} 操作`}>
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
